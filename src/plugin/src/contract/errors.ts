/**
 * 统一错误码。
 *
 * 设计原则：插件只负责「抛出错误码」，不负责「怎么呈现给用户」。
 * 宿主读到 code 后自行决定文案、重试按钮、引导付费等 UI 行为。
 * 这样插件才可能被任何一家大厂的工作台内置。
 */

export type PluginErrorCode =
  | "E_LLM_BUSY"
  | "E_LLM_TIMEOUT"
  | "E_LLM_UNREACHABLE"
  | "E_LLM_AUTH"
  | "E_LLM_BAD_RESPONSE"
  | "E_NO_API_KEY"
  | "E_RENDER_FAILED"
  | "E_INPUT_TOO_LONG"
  | "E_INPUT_INVALID"
  | "E_SESSION_NOT_FOUND"
  | "E_STAGE_INVALID"
  | "E_HOST_API_MISMATCH"
  | "E_UNKNOWN";

export interface PluginErrorSpec {
  retryable: boolean;
  /** 建议话术，宿主可以覆盖 */
  message: string;
}

export const ERROR_SPECS: Record<PluginErrorCode, PluginErrorSpec> = {
  E_LLM_BUSY: { retryable: true, message: "AI 服务有点忙（被限流了），请等 1 分钟再试" },
  E_LLM_TIMEOUT: { retryable: true, message: "AI 服务超时了，请重试" },
  // 连接层失败（DNS／连接被断／网关拒绝）。与「超时」区分开：
  // 它通常几秒内就返回，因此值得自动重试；而超时重试会让用户白等更久。
  E_LLM_UNREACHABLE: { retryable: true, message: "连不上 AI 服务，请检查网络后重试" },
  // 401/403：key 无效/过期/未开通模型。重试不会有不同结果，所以不可自动重试；
  // 单独成码是为了让「该不该换 key」一眼可判——此前它混在「未知错误」里。
  E_LLM_AUTH: { retryable: false, message: "API Key 无效或未授权，请更换有效的模型服务密钥" },
  E_LLM_BAD_RESPONSE: { retryable: true, message: "AI 返回格式异常，请重试" },
  E_NO_API_KEY: { retryable: false, message: "宿主未配置模型访问凭证" },
  // 宿主提供了 render 服务但渲染失败（无头浏览器异常、云端渲染超时等）。
  // 与「宿主没提供 render」区分开：后者是降级为 HTML，不是错误。
  E_RENDER_FAILED: { retryable: true, message: "PDF 生成失败，请重试" },
  E_INPUT_TOO_LONG: { retryable: false, message: "输入内容过长，请精简后再试" },
  E_INPUT_INVALID: { retryable: false, message: "输入内容不符合要求" },
  E_SESSION_NOT_FOUND: { retryable: false, message: "会话不存在或已过期，请重新开始" },
  E_STAGE_INVALID: { retryable: false, message: "当前阶段不允许该操作" },
  E_HOST_API_MISMATCH: { retryable: false, message: "插件与当前工作台版本不兼容" },
  E_UNKNOWN: { retryable: true, message: "出现未知错误，请重试" },
};

export class PluginError extends Error {
  code: PluginErrorCode;
  retryable: boolean;

  constructor(code: PluginErrorCode, detail?: string) {
    const spec = ERROR_SPECS[code] ?? ERROR_SPECS.E_UNKNOWN;
    super(detail ? `${spec.message}（${detail}）` : spec.message);
    this.name = "PluginError";
    this.code = code;
    this.retryable = spec.retryable;
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function toPluginError(e: unknown): PluginError {
  if (e instanceof PluginError) return e;
  return new PluginError("E_UNKNOWN", e instanceof Error ? e.message : String(e));
}
