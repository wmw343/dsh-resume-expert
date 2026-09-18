/**
 * 简历专家插件 —— 唯一对外出口。
 *
 * 宿主只需要做两件事：
 *   const instance = resumeExpertPlugin.create(hostServices);
 *   await instance.capability("intake").run({ raw: "帮我做份简历" }, ctx);
 *
 * 插件内部不认识任何框架、不读环境变量、不直连任何模型厂商。
 */

import manifest from "../plugin.manifest.json" with { type: "json" };

import type { HostServices } from "./contract/host.ts";
import type { Capability, Plugin, PluginInstance, WidgetFactory } from "./contract/plugin.ts";
import { PluginError } from "./contract/errors.ts";
import type { ResumeDraft } from "./model.ts";

import { createIntakeCapability, type IntakeInput } from "./capabilities/intake.ts";
import { createRefineCapability, type RefineInput } from "./capabilities/refine.ts";
import { createComposeCapability, type ComposeInput } from "./capabilities/compose.ts";
import {
  createTailorCapability,
  type TailorInput,
  type TailorOutput,
} from "./capabilities/tailor.ts";
import { createExportCapability, type ExportInput, type ExportOutput } from "./capabilities/export.ts";
import {
  createSetPhotoCapability,
  type SetPhotoInput,
  type SetPhotoOutput,
} from "./capabilities/photo.ts";

/** 本插件编译期要求的宿主 API 版本；宿主用 manifest.hostApi 做 semver 校验 */
export const HOST_API_VERSION = "1.0.0";

type CapabilityFactory = (host: HostServices) => Capability<never, unknown>;

const CAPABILITY_FACTORIES: Record<string, CapabilityFactory> = {
  intake: createIntakeCapability as unknown as CapabilityFactory,
  refine: createRefineCapability as unknown as CapabilityFactory,
  compose: createComposeCapability as unknown as CapabilityFactory,
  tailor: createTailorCapability as unknown as CapabilityFactory,
  export: createExportCapability as unknown as CapabilityFactory,
  "set-photo": createSetPhotoCapability as unknown as CapabilityFactory,
};

const WIDGET_ENTRIES: Record<string, () => Promise<unknown>> = {
  "resume-expert.main": () => import("./widgets/main.ts"),
};

export const resumeExpertPlugin: Plugin = {
  manifest: manifest as unknown as Plugin["manifest"],

  create(host: HostServices): PluginInstance {
    const instances = new Map<string, Capability<never, unknown>>();

    const getCapability = <TIn, TOut>(id: string): Capability<TIn, TOut> => {
      const cached = instances.get(id);
      if (cached) return cached as unknown as Capability<TIn, TOut>;

      const factory = CAPABILITY_FACTORIES[id];
      if (!factory) throw new PluginError("E_INPUT_INVALID", `未注册的能力：${id}`);

      const created = factory(host);
      instances.set(id, created);
      return created as unknown as Capability<TIn, TOut>;
    };

    return {
      capability: getCapability,
      widget(id: string): WidgetFactory {
        const loader = WIDGET_ENTRIES[id];
        if (!loader) throw new PluginError("E_INPUT_INVALID", `未注册的 widget：${id}`);
        return loader as WidgetFactory;
      },
      async dispose() {
        instances.clear();
      },
    };
  },
};

export default resumeExpertPlugin;

// —— 供宿主与二次开发者使用的类型出口 ——
export type {
  ResumeDraft,
  ResumeFacts,
  MissingItem,
  ModuleScore,
  Stage,
  ResumeStyle,
  ResumeFont,
  ResumeDensity,
} from "./model.ts";
export type { HostServices, CallContext, ChatMessage, RenderService, PdfResult } from "./contract/host.ts";
export type { Plugin, PluginInstance, Capability, PluginManifest } from "./contract/plugin.ts";
export type { IntakeInput } from "./capabilities/intake.ts";
export type { RefineInput } from "./capabilities/refine.ts";
export type { ComposeInput } from "./capabilities/compose.ts";
export type { TailorInput, TailorOutput } from "./capabilities/tailor.ts";
export type { ExportInput, ExportOutput } from "./capabilities/export.ts";
export type { SetPhotoInput, SetPhotoOutput } from "./capabilities/photo.ts";
export { PluginError, ERROR_SPECS } from "./contract/errors.ts";
export {
  scoreCompleteness,
  scoreModules,
  renderMarkdown,
  stripPlaceholders,
  deriveMissing,
  mergeFacts,
  emptyFacts,
  COMPOSE_THRESHOLD,
  DEFAULT_STYLE,
  DENSITY_ORDER,
} from "./model.ts";
export { renderResumeHtml } from "./render.ts";
