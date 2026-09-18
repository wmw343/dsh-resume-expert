import type { CallContext } from "../contract/host.ts";
import type { Capability } from "../contract/plugin.ts";
import type { HostServices } from "../contract/host.ts";
import { PluginError } from "../contract/errors.ts";
import { OFFTOPIC_FLAG, REFUSAL_TAILOR, buildTailorMessages } from "../prompts/tailor.ts";
import { extractJson } from "../prompts/common.ts";
import { MAX_INPUT, coerceFacts, loadDraft, looksLikeOverride, mapLlmError, sanitizeText, saveDraft } from "./shared.ts";
import type { ResumeFacts } from "../model.ts";

export interface TailorInput {
  jd: string;
  /** 要改写的简历文字稿。传了 sessionId 时可省略——会自动取会话里的当前稿 */
  resume?: string;
  /** 结构化事实。可选，给了模型改得更准（它不用从文字里反推结构） */
  facts?: ResumeFacts;
  /** 传了就把结果写回会话。界面上走的就是这条路 */
  sessionId?: string;
}

export interface TailorOutput {
  offTopic: boolean;
  markdown: string;
  /** 结构化结果。**导出 PDF 靠它**——只返回 markdown 的话，定制版出不了 PDF */
  facts?: ResumeFacts;
  reply?: string;
}

/**
 * 「按 JD 定制」—— 从 offer-ai 迁移过来的能力。
 *
 * 保留了两层防护：本地正则预检直白注入，以及模型侧的前置判断（返回 [OFFTOPIC] 标记）。
 *
 * ## 为什么它也要返回 `facts`
 *
 * 导出的 PDF 是用 `facts` 渲染的，不是用 markdown。**只返回 markdown 的话，
 * 定制结果就永远出不了 PDF**——用户能看到一版改写后的文字，却下载不到它。
 *
 * 这和 compose 曾经的问题**同一个病根**：字段在提示词里存在，却没流到消费它的那一层。
 * 所以这里和 compose 对齐：同时返回 `facts` 与 `markdown`。
 *
 * ## 为什么它还要接 `sessionId`
 *
 * widget 没有 storage 写权限——**持久化是能力层的职责**（`set-photo` 也是这个模式）。
 * 界面要"定制完立刻看到新版 PDF"，就必须由能力层把结果写回会话。
 * 不传 `sessionId` 时它退化成无状态的纯改写，原有的调用方式不受影响。
 */
export function createTailorCapability(host: HostServices): Capability<TailorInput, TailorOutput> {
  return {
    id: "tailor",
    async run(input: TailorInput, ctx: CallContext): Promise<TailorOutput> {
      const jd = sanitizeText(input?.jd, MAX_INPUT);
      if (!jd) throw new PluginError("E_INPUT_INVALID", "需要提供岗位 JD");

      const sessionId = sanitizeText(input?.sessionId, 80);

      // 有会话就以会话为准：界面调用时不会再传一遍全文
      const prev = sessionId ? await loadDraft(host, ctx, sessionId) : null;
      const resume = sanitizeText(input?.resume, MAX_INPUT) || prev?.markdown || "";
      const facts = input?.facts ?? prev?.facts;

      if (!resume.trim()) {
        throw new PluginError("E_INPUT_INVALID", "需要提供简历内容（或一个已有稿子的 sessionId）");
      }
      if (looksLikeOverride(jd) || looksLikeOverride(resume)) {
        return { offTopic: true, markdown: "", reply: REFUSAL_TAILOR };
      }

      let raw: string;
      try {
        raw = await host.llm.complete(buildTailorMessages(jd, resume, facts), {
          temperature: 0.6,
          // 和 compose 同理：现在要同时吐出改写后的完整 facts + markdown，
          // 输出量与耗时都明显上去了，预算得跟上（实测小预算会出现"思考占满上限、正文为空"）
          maxTokens: 16384,
          timeoutMs: 180000,
          retries: 1,
          signal: ctx.signal,
        });
      } catch (e) {
        throw mapLlmError(e);
      }

      const text = (raw ?? "").trim();

      // 离题判断放在 JSON 解析**之前**：那种情况模型刻意只输出一行纯文本，
      // 先解析 JSON 会把它当成"格式错误"，把一次正常的拒答报成故障。
      if (text.includes(OFFTOPIC_FLAG)) {
        return { offTopic: true, markdown: "", reply: REFUSAL_TAILOR };
      }

      const parsed = extractJson(text) as { reply?: unknown; facts?: unknown; markdown?: unknown } | null;
      if (!parsed) {
        host.telemetry.error("resume.parse_failed", new Error("tailor json parse failed"), {
          sample: text.slice(0, 200),
        });
        throw new PluginError("E_LLM_BAD_RESPONSE", "定制结果不是可解析的 JSON");
      }

      const markdown = typeof parsed.markdown === "string" ? parsed.markdown.trim() : "";
      // 一份简历不可能只有几个字；过短一律按失败处理，避免把残句当成品交给用户
      if (markdown.length < 40) {
        throw new PluginError("E_LLM_BAD_RESPONSE", `改写结果过短（${markdown.length} 字）`);
      }

      const nextFacts = parsed.facts ? coerceFacts(parsed.facts) : undefined;
      const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : undefined;

      // 写回会话：让界面立刻能预览新版、下载新 PDF
      if (prev) {
        prev.facts = nextFacts ?? prev.facts;
        prev.markdown = markdown;
        prev.updatedAt = Date.now();
        await saveDraft(host, ctx, prev);
      }

      return { offTopic: false, markdown, facts: nextFacts, reply };
    },
  };
}
