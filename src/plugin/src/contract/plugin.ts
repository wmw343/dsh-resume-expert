/**
 * 插件对外暴露的契约。
 *
 * 分三层，互相独立：
 *   capability（能力层）—— 纯逻辑，可被宿主编排进 Agent 流程
 *   widget（界面层）    —— 用户可见的交互界面，可懒加载
 *   两者共用同一个 manifest 描述，宿主自行决定以哪种形态暴露。
 */

import type { HostServices, CallContext } from "./host.ts";

export type Permission =
  | "llm"
  | "auth"
  | "storage"
  | "telemetry"
  | "config";

export interface CapabilityDescriptor {
  id: string;
  title: string;
  description: string;
  /** 入参/出参的 JSON Schema，宿主可据此做运行时校验与自动生成表单 */
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissions: Permission[];
}

export interface WidgetDescriptor {
  id: string;
  title: string;
  /** 相对插件根目录的入口，宿主按需动态加载 */
  entry: string;
  size: "inline" | "panel" | "fullscreen";
  /** 是否允许宿主在空闲时预热 */
  preload?: boolean;
  permissions: Permission[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** 要求的宿主 API 版本（semver range），宿主启动时校验 */
  hostApi: string;
  entry: string;
  description: string;
  capabilities: CapabilityDescriptor[];
  widgets: WidgetDescriptor[];
  permissions: Permission[];
}

export interface Capability<TIn, TOut> {
  id: string;
  run(input: TIn, ctx: CallContext): Promise<TOut>;
}

export type WidgetFactory = () => Promise<unknown>;

export interface PluginInstance {
  capability<TIn, TOut>(id: string): Capability<TIn, TOut>;
  widget(id: string): WidgetFactory;
  dispose(): Promise<void>;
}

export interface Plugin {
  manifest: PluginManifest;
  create(host: HostServices): PluginInstance;
}
