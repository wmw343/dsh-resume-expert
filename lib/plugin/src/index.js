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
import { PluginError } from "./contract/errors.js";
import { createIntakeCapability } from "./capabilities/intake.js";
import { createRefineCapability } from "./capabilities/refine.js";
import { createComposeCapability } from "./capabilities/compose.js";
import { createTailorCapability, } from "./capabilities/tailor.js";
import { createExportCapability } from "./capabilities/export.js";
import { createSetPhotoCapability, } from "./capabilities/photo.js";
/** 本插件编译期要求的宿主 API 版本；宿主用 manifest.hostApi 做 semver 校验 */
export const HOST_API_VERSION = "1.0.0";
const CAPABILITY_FACTORIES = {
    intake: createIntakeCapability,
    refine: createRefineCapability,
    compose: createComposeCapability,
    tailor: createTailorCapability,
    export: createExportCapability,
    "set-photo": createSetPhotoCapability,
};
const WIDGET_ENTRIES = {
    "resume-expert.main": () => import("./widgets/main.js"),
};
export const resumeExpertPlugin = {
    manifest: manifest,
    create(host) {
        const instances = new Map();
        const getCapability = (id) => {
            const cached = instances.get(id);
            if (cached)
                return cached;
            const factory = CAPABILITY_FACTORIES[id];
            if (!factory)
                throw new PluginError("E_INPUT_INVALID", `未注册的能力：${id}`);
            const created = factory(host);
            instances.set(id, created);
            return created;
        };
        return {
            capability: getCapability,
            widget(id) {
                const loader = WIDGET_ENTRIES[id];
                if (!loader)
                    throw new PluginError("E_INPUT_INVALID", `未注册的 widget：${id}`);
                return loader;
            },
            async dispose() {
                instances.clear();
            },
        };
    },
};
export default resumeExpertPlugin;
export { PluginError, ERROR_SPECS } from "./contract/errors.js";
export { scoreCompleteness, scoreModules, renderMarkdown, stripPlaceholders, deriveMissing, mergeFacts, emptyFacts, COMPOSE_THRESHOLD, DEFAULT_STYLE, DENSITY_ORDER, } from "./model.js";
export { renderResumeHtml } from "./render.js";
