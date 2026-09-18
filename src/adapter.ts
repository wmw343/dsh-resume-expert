/**
 * 简历专家 × DSH 适配层：把插件的 HostServices 契约落在 DSH 环境上。
 * 密钥/厂商/重试全部在这一层（宿主侧）；plugin/ 保持零改动。
 */
import os from "node:os";
import path from "node:path";
import { createRealLlm } from "./plugin-llm.ts";
import { createRenderService } from "./render.ts";
import { createFileKv } from "./store.ts";
import type { HostServices, CallContext } from "./plugin/src/contract/host.ts";

export function buildHostServices(): HostServices {
  const apiKey = (process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY（放入启动 dsh 的环境或 .env）");

  const logger = {
    info: (m: string, ...a: unknown[]) => console.log(`[resume-expert] ${m}`, ...a),
    warn: (m: string, ...a: unknown[]) => console.warn(`[resume-expert] ${m}`, ...a),
    error: (m: string, ...a: unknown[]) => console.error(`[resume-expert] ${m}`, ...a),
  };

  // —— 文件型 KV：重启 dsh web 后会话不丢（详见 store.ts 的决策留痕）——
  // 默认落在 DSH 主目录（~/.dsh），可用 RESUME_EXPERT_STORE 覆盖路径。
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const storeFile = process.env.RESUME_EXPERT_STORE || path.join(dshHome, "resume-expert-store.json");
  const storage = createFileKv(storeFile);
  logger.info(`会话持久化：${storeFile}`);

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
