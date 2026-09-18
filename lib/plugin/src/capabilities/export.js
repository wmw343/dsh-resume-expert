import { PluginError } from "../contract/errors.js";
import { DENSITY_ORDER, } from "../model.js";
import { normalizeStyle, renderResumeHtml } from "../render.js";
import { loadDraft, normalizePhoto, sanitizeText, saveDraft } from "./shared.js";
/**
 * 阶段四：导出。
 *
 * 两条产出路径：
 *  - 宿主提供了 render 服务 → **直出 PDF 字节**，用户一键下载
 *  - 未提供 → 返回打印优化 HTML，由浏览器打印 / 另存为（降级）
 *
 * 插件对两者都必须支持。因为「能不能出 PDF」取决于宿主环境，
 * 不该让用户在点按钮那一刻才发现不行——所以用 pdfUnavailableReason 把降级原因显式交出去。
 */
export function createExportCapability(host) {
    return {
        id: "export",
        async run(input, ctx) {
            const sessionId = sanitizeText(input?.sessionId, 80);
            if (!sessionId)
                throw new PluginError("E_INPUT_INVALID", "缺少 sessionId");
            const prev = await loadDraft(host, ctx, sessionId);
            // 照片也可随导出一起传（一次性流程）；校验与 set-photo 共用，避免两处规则漂移
            const photo = normalizePhoto(input?.photo) ?? prev.photo;
            const style = normalizeStyle({ ...prev.style, ...(input?.style ?? {}) });
            const wantPdf = input?.format === "pdf" || (input?.format === undefined && Boolean(host.render));
            const fitSinglePage = input?.fitSinglePage === true;
            let html = renderResumeHtml(prev.facts, { photo, style });
            let pdf;
            let pages = 0;
            let effective = style;
            if (wantPdf && host.render) {
                // 「压到一页」：逐档收紧密度重渲染。
                // 只有拿到真实页数才做得了——所以页数由宿主的 render 服务返回。
                const startIdx = Math.max(0, DENSITY_ORDER.indexOf(style.density));
                for (let i = startIdx; i < DENSITY_ORDER.length; i++) {
                    const density = DENSITY_ORDER[i];
                    effective = { ...style, density };
                    html = renderResumeHtml(prev.facts, { photo, style: effective });
                    const rendered = await host.render.pdf(html, { filename: "resume" });
                    pages = rendered.pages;
                    const isLastDensity = i === DENSITY_ORDER.length - 1;
                    if (!fitSinglePage || pages <= 1 || isLastDensity) {
                        pdf = { base64: rendered.base64, pages };
                        break;
                    }
                    host.telemetry.event("resume.export.shrink", { from: density, pages });
                }
            }
            await saveDraft(host, ctx, {
                ...prev,
                stage: "export",
                photo,
                style: effective,
                updatedAt: Date.now(),
            });
            const out = {
                html,
                hasPhoto: Boolean(photo),
                stage: "export",
                style: effective,
                format: pdf ? "pdf" : "html",
            };
            if (pdf)
                out.pdf = pdf;
            if (!pdf && wantPdf) {
                out.pdfUnavailableReason =
                    "当前工作台没有提供 PDF 渲染能力，已改为生成可打印的简历页面";
            }
            host.telemetry.event("resume.export", {
                hasPhoto: Boolean(photo),
                format: out.format,
                pages,
                density: effective.density,
            });
            return out;
        },
    };
}
