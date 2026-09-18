/**
 * 插件宿主的服务契约（唯一耦合面）。
 *
 * 三条不可妥协的设计要点：
 *  1. 全部方法都是 async —— 即使当前实现是同步的；
 *  2. 出入参必须可 JSON 序列化 —— 不传函数、不传类实例、不传 Symbol；
 *  3. 不出现任何厂商名、表名、cookie 名。
 *
 * 满足这三条，插件将来可以被「零改动」地搬进 iframe / Web Worker 沙箱，
 * 也才能被任意一家大厂的工作台内置。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 429 重试次数；分类器等低延迟场景传 0 快速失败 */
  retries?: number;
  signal?: AbortSignal;
}

export interface LLMService {
  /** 宿主负责厂商选择、密钥托管与传输层重试；插件只说「给我一段补全」 */
  complete(messages: ChatMessage[], opts?: LlmCallOptions): Promise<string>;
}

export interface HostUser {
  id: string;
  name?: string;
  /** 宿主自己解释这个字段的含义（会员、席位、部门等），插件不关心 */
  entitlements?: string[];
}

export interface AuthService {
  current(): Promise<HostUser | null>;
}

/** 会话存储：插件把跨轮次的简历状态交给宿主持久化，自身保持无状态 */
export interface StorageService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface TelemetryService {
  event(name: string, props?: Record<string, string | number | boolean>): void;
  error(name: string, err: unknown, props?: Record<string, unknown>): void;
}

export interface ConfigService {
  /** 宿主可下发运营参数（例如是否开放某模块），插件不读 process.env */
  get<T>(key: string, fallback: T): T;
}

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * PDF 渲染结果。
 *
 * 注意：字节用 base64 字符串承载，而不是 Uint8Array ——
 * 契约要求出入参可 JSON 序列化，TypedArray 过不了 RPC（会被拆成 {"0":..,"1":..}）。
 * 这类小地方最容易在"以后要搬进 iframe"时翻车，所以一开始就守住。
 */
export interface PdfResult {
  /** base64 编码的 PDF 字节 */
  base64: string;
  /** 实际页数。插件用它做「压缩到一页」的自适应排版 */
  pages: number;
}

/**
 * HTML → PDF 渲染服务。
 *
 * 为什么把它做成宿主能力而不是插件自带：
 *   PDF 渲染本质是**环境能力**，和「调用大模型」同一性质——
 *   它需要无头浏览器或云端渲染集群，属于宿主的地盘。
 *   做成契约的一部分，接入方可以直接接自己的渲染服务（甚至打印集群），
 *   插件则保持零依赖、可跑在任何沙箱里。
 *
 * 可选：未提供时插件降级为「返回打印优化 HTML，由浏览器打印/另存为 PDF」。
 */
export interface RenderService {
  pdf(html: string, opts?: { filename?: string }): Promise<PdfResult>;
}

export interface HostServices {
  /** 宿主 API 版本，插件用 manifest.hostApi 做 semver 校验 */
  hostVersion: string;
  llm: LLMService;
  auth: AuthService;
  storage: StorageService;
  telemetry: TelemetryService;
  config: ConfigService;
  logger: Logger;
  /**
   * 可选。提供后 export 能力可直出 PDF；不提供则返回 HTML（旧行为）。
   * 插件必须能在这两种宿主下都正常工作。
   */
  render?: RenderService;
}

export interface CallContext {
  user: HostUser | null;
  traceId: string;
  signal?: AbortSignal;
}
