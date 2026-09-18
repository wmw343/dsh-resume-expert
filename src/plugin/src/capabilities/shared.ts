import type { ChatMessage, HostServices, CallContext } from "../contract/host.ts";
import { PluginError, ERROR_SPECS, toPluginError } from "../contract/errors.ts";
import type { PluginErrorCode } from "../contract/errors.ts";
import { extractJson } from "../prompts/common.ts";
import {
  deriveMissing,
  normalizeSkills,
  renderMarkdown,
  scoreCompleteness,
  scoreModules,
  stripPlaceholders,
  type MissingItem,
  type Priority,
  type ResumeDraft,
  type ResumeFacts,
  type Stage,
} from "../model.ts";

export const MAX_INPUT = 8000;
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const MAX_PHOTO_CHARS = 4_000_000;
const PHOTO_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * 校验并归一化证件照。
 *
 * 抽出来共用是因为 set-photo 与 export 都会收照片：
 * 两处各写一套校验，迟早会出现"一个入口放行、另一个拦截"的裂缝。
 * 返回 undefined 表示「未提供」，由调用方决定是沿用旧值还是清除。
 */
export function normalizePhoto(input: unknown): string | undefined {
  const s = typeof input === "string" ? input.trim() : "";
  if (!s) return undefined;
  if (!PHOTO_DATA_URL_RE.test(s)) {
    throw new PluginError("E_INPUT_INVALID", "照片需为 png / jpg / webp 的 data URL");
  }
  if (s.length > MAX_PHOTO_CHARS) {
    throw new PluginError("E_INPUT_TOO_LONG", "照片文件过大（请压缩到 3MB 以内）");
  }
  return s;
}

const CONFLICT_TOKENS = /<{2,}|>{2,}/g;
const OVERRIDE_RE =
  /(忽略|无视|覆盖|忘记)[\s\S]{0,8}(以上|上面|之前|所有|全部)[\s\S]{0,8}(指令|规则|提示|设定|系统)|ignore[\s\S]{0,40}(previous|above)[\s\S]{0,40}(instruction|prompt|rule)|system[\s\S]{0,3}prompt|developer[\s\S]{0,3}mode|\bDAN\b/i;

/** 剥离控制符与分隔符，防止用户提前闭合 <<< >>> 逃逸出数据区 */
export function sanitizeText(input: unknown, maxLen = MAX_INPUT): string {
  if (typeof input !== "string") return "";
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x09 || c === 0x0a) {
      out += ch;
      continue;
    }
    if (c < 0x20 || c === 0x7f) continue;
    if (c >= 0x200b && c <= 0x200f) continue;
    if (c >= 0x202a && c <= 0x202e) continue;
    if (c === 0xfeff) continue;
    out += ch;
  }
  return out.replace(CONFLICT_TOKENS, "").slice(0, maxLen).trim();
}

export function looksLikeOverride(s: string): boolean {
  return OVERRIDE_RE.test(s);
}

export function newSessionId(): string {
  return `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionKey(ctx: CallContext, sessionId: string): string {
  const owner = ctx.user?.id ?? "anon";
  return `resume-expert/v1/${owner}/${sessionId}`;
}

/**
 * 读会话。
 *
 * **这里是老数据的入口**：早期版本存进宿主 storage 的 `skills` 是 `string[]`，
 * 而现在的形状是 `SkillGroup[]`。不在这里归一化，老会话读出来就是旧形状，
 * 一路流到 refine / compose / export，最后表现为"技能栏凭空消失"。
 *
 * 归一化是幂等的，所以在读的边界统一做一次，下游全都不用管。
 */
export async function loadDraft(
  host: HostServices,
  ctx: CallContext,
  sessionId: string
): Promise<ResumeDraft> {
  const draft = await host.storage.get<ResumeDraft>(sessionKey(ctx, sessionId));
  if (!draft) throw new PluginError("E_SESSION_NOT_FOUND", sessionId);
  if (draft.facts) draft.facts.skills = normalizeSkills(draft.facts.skills);
  return draft;
}

export async function saveDraft(
  host: HostServices,
  ctx: CallContext,
  draft: ResumeDraft
): Promise<void> {
  await host.storage.set(sessionKey(ctx, draft.sessionId), draft, SESSION_TTL_MS);
}

function coercePriority(v: unknown): Priority {
  return v === "high" || v === "medium" || v === "low" ? v : "medium";
}

function coerceMissing(raw: unknown): MissingItem[] {
  if (!Array.isArray(raw)) return [];
  const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return raw
    .map((item) => {
      const o = (item ?? {}) as Record<string, unknown>;
      const label = sanitizeText(o.label, 200);
      if (!label) return null;
      return {
        key: sanitizeText(o.key, 80) || label.slice(0, 20),
        module: (sanitizeText(o.module, 20) || "extras") as MissingItem["module"],
        label,
        why: sanitizeText(o.why, 200),
        hint: sanitizeText(o.hint, 200),
        priority: coercePriority(o.priority),
      } satisfies MissingItem;
    })
    .filter((x): x is MissingItem => x !== null)
    .sort((a, b) => rank[a.priority] - rank[b.priority]);
}

/**
 * 把模型返回的裸对象收成 ResumeFacts。
 *
 * ⚠️ **这是一个白名单**——`ResumeFacts` 里有的字段，这里没列出来就会被**静默丢掉**。
 *
 * 真实踩坑：给 facts 加了 `metrics` 字段、提示词也写了、渲染也做了，
 * 但忘了加到这里，结果"模型明明返回了"却一路是空数组，查了半天。
 * 这是和「compose 契约断裂」同一类的 bug：**字段在类型和提示词里存在，
 * 却在某个边界被过滤掉**。
 *
 * 所以 `test/selftest.ts` 里配了一条**回路测试**：把一份填满的 facts 跑一遍
 * `coerceFacts`，断言没有任何字段丢失。加新字段时它会当场失败。
 */
export function coerceFacts(raw: unknown): ResumeFacts {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const arr = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? (v as T[]) : undefined);
  const strList = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v.map((x) => sanitizeText(x, 300)).filter(Boolean);
    return out.length ? out : undefined;
  };
  return {
    target: sanitizeText(o.target, 80) || undefined,
    basics: (o.basics as ResumeFacts["basics"]) ?? undefined,
    education: arr(o.education),
    experience: arr(o.experience),
    projects: arr(o.projects),
    skills: normalizeSkills(o.skills),
    metrics: strList(o.metrics),
    awards: strList(o.awards),
    summary: sanitizeText(o.summary, 1000) || undefined,
  };
}

export interface LlmJsonResult {
  reply: string;
  facts: ResumeFacts;
  markdown: string;
  missing: MissingItem[];
  nextQuestion: string;
}

/** 从任意错误对象上读合法 code（**不依赖 instanceof**：跨模块、跨序列化边界时不共享类身份） */
function readErrorCode(e: unknown): PluginErrorCode | null {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "string" && c in ERROR_SPECS ? (c as PluginErrorCode) : null;
}

/**
 * 生成附加说明，但**不重复 spec 里的固定话术**。
 *
 * 宿主抛 `PluginError` 时，它的 message 已经是「固定话术（细节）」；
 * 整条再当 detail 传进去会变成「固定话术（固定话术（细节））」。
 * 所以先剥掉固定话术前缀与包裹的括号。
 */
function detailWithoutSpec(e: unknown, code: PluginErrorCode): string | undefined {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg) return undefined;
  const spec = ERROR_SPECS[code].message;
  const rest = msg.startsWith(spec) ? msg.slice(spec.length) : msg;
  const cleaned = rest
    .replace(/^[（(]\s*/, "")
    .replace(/\s*[）)]\s*$/, "")
    .trim();
  return cleaned || undefined;
}

/**
 * 把宿主抛出的错误映射成插件错误码。
 *
 * **优先读结构化 code，正则只做兜底。**
 *
 * 契约的方向是「插件只抛错误码，宿主读到 code 后自行决定文案」（见 `contract/errors.ts`
 * 文件头），所以宿主抛错时**应该**带上 code。若只认文案，接入方把
 * 「模型服务认证失败（HTTP 401）」改写成「`401 Unauthorized`」（HTTP 标准措辞），
 * `E_LLM_AUTH` 就退化成 `E_UNKNOWN`——「用户一眼判断该不该换 key」这个承诺随之失效。
 * 而错误码体系正是给接入方看的那份契约的核心。
 *
 * **正则兜底必须保留**：老宿主（含本仓库参考宿主改造前）抛的是裸 Error，无 code 可读。
 * 砍掉兜底会把「可能误分类」变成「必然 E_UNKNOWN」，比现状更差。
 *
 * @see docs/改进项清单.md 的 B2
 */
export function mapLlmError(e: unknown): PluginError {
  if (e instanceof PluginError) return e;

  // ① 结构化：任何带合法 code 的错误对象
  const code = readErrorCode(e);
  if (code) return new PluginError(code, detailWithoutSpec(e, code));

  // ② 文案兜底（老宿主 / 第三方宿主可能只抛裸 Error）
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort|timeout|超时/i.test(msg)) return new PluginError("E_LLM_TIMEOUT", msg);
  if (/429|限流/.test(msg)) return new PluginError("E_LLM_BUSY", msg);
  // 401/403（key 无效/过期/未开通）——必须在「未知错误」兜底之前认出来，
  // 否则用户永远无法从报错判断「是不是该换 key」。
  // 额外认 `401/403` 与 Unauthorized/Forbidden：接入方若用 HTTP 标准英文措辞，不认这两个词就会漏。
  if (/\b(401|403)\b|认证失败|API Key|Unauthorized|Forbidden/i.test(msg)) {
    return new PluginError("E_LLM_AUTH", msg);
  }
  // 连接层失败：Node 的 fetch 会统一抛出 "fetch failed"，具体原因在 cause 里
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network/i.test(msg)) {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const detail = cause?.code ?? cause?.message ?? msg;
    return new PluginError("E_LLM_UNREACHABLE", detail);
  }
  // 空内容 / 非 JSON / 格式异常，都归到「模型返回不可用」，宿主可以对它重试
  if (/空内容|非 JSON|格式|JSON/.test(msg)) return new PluginError("E_LLM_BAD_RESPONSE", msg);
  return new PluginError("E_UNKNOWN", msg);
}

/** 哪些错误值得「自动重试一次」：返回结果不可用，或连接层抖动 */
const AUTO_RETRY_CODES = new Set(["E_LLM_BAD_RESPONSE", "E_LLM_UNREACHABLE"]);

async function callLlmJsonOnce(
  host: HostServices,
  messages: ChatMessage[],
  ctx: CallContext,
  budget?: { timeoutMs?: number }
): Promise<LlmJsonResult> {
  const DEFAULT_TIMEOUT_MS = 120000;
  let raw: string;
  try {
    raw = await host.llm.complete(messages, {
      temperature: 0.6,
      // intake 要一次性吐出「诊断 + 完整 facts + 待补清单 + 追问」，输出本就长；
      // 用户若直接贴一份完整简历，facts 会更大，再叠加模型的思考 token 很容易撞上限
      // （表现为 finish_reason=length、正文被截空、JSON 解析失败）。
      // 所以给足预算：省下的那点 token 远不值一次"AI 返回格式异常"。
      maxTokens: 16384,
      timeoutMs: budget?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: 1,
      signal: ctx.signal,
    });
  } catch (e) {
    throw mapLlmError(e);
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    host.telemetry.error("resume.parse_failed", new Error("json parse failed"), {
      sample: raw.slice(0, 200),
    });
    throw new PluginError("E_LLM_BAD_RESPONSE");
  }

  const facts = coerceFacts(parsed.facts);
  return {
    reply: sanitizeText(parsed.reply, 4000) || "我已经更新了你的简历草稿。",
    facts,
    markdown: typeof parsed.markdown === "string" ? parsed.markdown.trim() : "",
    missing: coerceMissing(parsed.missing),
    nextQuestion: sanitizeText(parsed.nextQuestion, 300),
  };
}

/**
 * 调模型并取回结构化结果。
 *
 * 对「模型这次没给出可用结果」自动重试一次：
 * 实测同一份提示词，模型偶发会返回空内容或非 JSON（表现为整轮失败）。
 * 这类抖动不该让用户看到报错——多点一次按钮的体验损耗，比多花一次调用大得多。
 * 但输入类错误（如超长）不重试，重试也不会有不同结果。
 */
/**
 * 调模型并取回结构化结果。
 *
 * `budget` 允许各阶段自己调超时：**compose 是最重的阶段**——
 * 它既要润色 markdown、又要把润色后的完整 facts 一起返回（导出 PDF 用的是 facts），
 * 输出量明显大于 intake / refine。用同一套预算会让"粘一份完整简历再点生成定稿"
 * 这种最需要它的场景恰好超时。
 */
export async function callLlmJson(
  host: HostServices,
  messages: ChatMessage[],
  ctx: CallContext,
  budget?: { timeoutMs?: number }
): Promise<LlmJsonResult> {
  const MAX_ATTEMPTS = 2;
  let lastError: PluginError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await callLlmJsonOnce(host, messages, ctx, budget);
    } catch (e) {
      lastError = mapLlmError(e);
      const canRetry = AUTO_RETRY_CODES.has(lastError.code) && attempt < MAX_ATTEMPTS - 1;
      if (!canRetry) throw lastError;
      host.logger.warn(
        `[resume-expert] 模型返回不可用，重试第 ${attempt + 2} 次：${lastError.message}`
      );
      host.telemetry.event("resume.llm_retry", { attempt: attempt + 2, reason: lastError.code });
    }
  }

  throw lastError ?? new PluginError("E_UNKNOWN");
}

/**
 * 组装一份自洽的 draft：完整度本地算、清单兜底、文字稿兜底。
 *
 * missing 的语义在这里很关键：
 *   - 不传（undefined）→ 说明调用方没拿到有效清单，回落到本地兜底清单，保证体验不空；
 *   - 传空数组 []      → 说明调用方**明确表示没有缺口**（例如成稿阶段），不要再塞回兜底。
 * 这两种情况必须区分，否则「成稿后仍在提示待补充」这种怪现象就会出现。
 */
export function buildDraft(params: {
  sessionId: string;
  stage: Stage;
  facts: ResumeFacts;
  markdown?: string;
  missing?: MissingItem[];
  reply: string;
  nextQuestion: string;
  photo?: string;
}): ResumeDraft {
  const { sessionId, stage, facts, markdown, missing, reply, nextQuestion, photo } = params;
  const finalMissing = missing === undefined ? deriveMissing(facts) : missing;
  // 兜底渲染也要区分草稿/定稿：成稿阶段不该再出现「（待补充）」和空标题
  const isFinal = stage === "compose" || stage === "export";

  // 定稿要过一道净化：模型偶发输出的「（待补充）」和空壳分节在这里被清掉。
  // 净化后如果什么都不剩，再退回本地渲染，保证定稿永远不为空。
  const rawMarkdown = markdown && markdown.trim() ? markdown : "";
  const normalized = rawMarkdown
    ? isFinal
      ? stripPlaceholders(rawMarkdown)
      : rawMarkdown
    : "";
  const finalMarkdown = normalized.trim() ? normalized : renderMarkdown(facts, { final: isFinal });
  return {
    sessionId,
    stage,
    facts,
    markdown: finalMarkdown,
    missing: finalMissing,
    completeness: scoreCompleteness(facts),
    breakdown: scoreModules(facts),
    nextQuestion,
    reply,
    photo,
    updatedAt: Date.now(),
  };
}

export function hostError(e: unknown): PluginError {
  return toPluginError(e);
}
