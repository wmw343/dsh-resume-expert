import type { CallContext, HostServices } from "../contract/host.ts";
import type { Capability } from "../contract/plugin.ts";
import { PluginError } from "../contract/errors.ts";
import {
  DENSITY_ORDER,
  type ResumeDensity,
  type ResumeStyle,
  type Stage,
} from "../model.ts";
import { normalizeStyle, renderResumeHtml } from "../render.ts";
import { loadDraft, normalizePhoto, sanitizeText, saveDraft } from "./shared.ts";

export interface ExportInput {
  sessionId: string;
  /** 证件照 data URL。不传则沿用会话里已保存的照片 */
  photo?: string;
  /**
   * "html" 只返回 HTML（宿主可自行打印）；
   * "pdf"  需要宿主提供 render 服务；
   * 缺省：宿主有 render 就用 pdf，否则回落到 html。
   */
  format?: "html" | "pdf";
  /** 排版样式，只传要改的字段 */
  style?: Partial<ResumeStyle>;
  /** 尽量压到一页：会逐档收紧密度重渲染，最多试 3 档 */
  fitSinglePage?: boolean;
}

export interface ExportOutput {
  html: string;
  hasPhoto: boolean;
  stage: Stage;
  /** 实际生效的样式（含自动收紧后的密度），宿主 UI 可据此回显 */
  style: ResumeStyle;
  /** 实际产出的格式 */
  format: "html" | "pdf";
  /** format === "pdf" 时有值 */
  pdf?: { base64: string; pages: number };
  /** 想要 PDF 但宿主没提供 render 服务时给出原因，供 UI 降级提示 */
  pdfUnavailableReason?: string;
}

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
export function createExportCapability(host: HostServices): Capability<ExportInput, ExportOutput> {
  return {
    id: "export",
    async run(input: ExportInput, ctx: CallContext): Promise<ExportOutput> {
      const sessionId = sanitizeText(input?.sessionId, 80);
      if (!sessionId) throw new PluginError("E_INPUT_INVALID", "缺少 sessionId");

      const prev = await loadDraft(host, ctx, sessionId);

      // 照片也可随导出一起传（一次性流程）；校验与 set-photo 共用，避免两处规则漂移
      const photo = normalizePhoto(input?.photo) ?? prev.photo;

      const style = normalizeStyle({ ...prev.style, ...(input?.style ?? {}) });
      const wantPdf = input?.format === "pdf" || (input?.format === undefined && Boolean(host.render));
      const fitSinglePage = input?.fitSinglePage === true;

      let html = renderResumeHtml(prev.facts, { photo, style });
      let pdf: { base64: string; pages: number } | undefined;
      let pages = 0;
      let effective = style;

      if (wantPdf && host.render) {
        // 「压到一页」：逐档收紧密度重渲染。
        // 只有拿到真实页数才做得了——所以页数由宿主的 render 服务返回。
        const startIdx = Math.max(0, DENSITY_ORDER.indexOf(style.density));
        for (let i = startIdx; i < DENSITY_ORDER.length; i++) {
          const density: ResumeDensity = DENSITY_ORDER[i];
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

      const out: ExportOutput = {
        html,
        hasPhoto: Boolean(photo),
        stage: "export",
        style: effective,
        format: pdf ? "pdf" : "html",
      };
      if (pdf) out.pdf = pdf;
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
