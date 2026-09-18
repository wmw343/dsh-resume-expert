/**
 * 简历专家 × DSH 适配层：把插件的 HostServices 契约落在 DSH 环境上。
 * 密钥/厂商/重试全部在这一层（宿主侧）；plugin/ 保持零改动。
 */
import { createRealLlm } from "./plugin-llm.ts";
import { createRenderService } from "./render.ts";
import type { HostServices, CallContext } from "./plugin/src/contract/host.ts";

export function buildHostServices(): HostServices {
  const apiKey = (process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY（放入启动 dsh 的环境或 .env）");

  const logger = {
    info: (m: string, ...a: unknown[]) => console.log(`[resume-expert] ${m}`, ...a),
    warn: (m: string, ...a: unknown[]) => console.warn(`[resume-expert] ${m}`, ...a),
    error: (m: string, ...a: unknown[]) => console.error(`[resume-expert] ${m}`, ...a),
  };

  // —— 内存 KV（与 demo 宿主同款；TTL 到期惰性清除）——
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  const storage = {
    async get<T>(key: string): Promise<T | null> {
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expiresAt && Date.now() > hit.expiresAt) {
        store.delete(key);
        return null;
      }
      return hit.value as T;
    },
    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
  };

  return {
    hostVersion: "1.0.0",
    // DeepSeek 官方 API 是 OpenAI 兼容协议，正好匹配插件契约
    llm: createRealLlm({
      baseUrl: "https://api.deepseek.com/v1/chat/completions",
      apiKey,
      model: "deepseek-chat",
      maxTokens: 8192,
    }),
    auth: {
      async current() {
        return { id: "dsh-user", name: "DSH 用户", entitlements: ["resume-expert"] };
      },
    },
    storage,
    telemetry: {
      event: (name, props) => logger.info(`[telemetry] ${name}`, props ?? {}),
      error: (name, err) =>
        logger.error(`[telemetry] ${name}`, err instanceof Error ? err.message : String(err)),
    },
    config: {
      get: <T,>(_key: string, fallback: T): T => fallback,
    },
    logger,
    // 本机有 Chrome/Edge 就直出 PDF；没有则返回 undefined，插件自动降级为打印 HTML
    render: createRenderService() ?? undefined,
  };
}

export function buildContext(signal?: AbortSignal): CallContext {
  return {
    user: { id: "dsh-user", name: "DSH 用户" },
    traceId: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    signal,
  };
}
