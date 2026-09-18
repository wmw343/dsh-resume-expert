import type { CallContext, HostServices } from "../contract/host.ts";
import type { Capability } from "../contract/plugin.ts";
import { PluginError } from "../contract/errors.ts";
import type { Stage } from "../model.ts";
import { loadDraft, normalizePhoto, sanitizeText, saveDraft } from "./shared.ts";

export interface SetPhotoInput {
  sessionId: string;
  /** 照片 data URL。传空字符串表示**移除**照片 */
  photo: string;
}

export interface SetPhotoOutput {
  hasPhoto: boolean;
  /** 当前生效的照片（已移除则为 undefined） */
  photo?: string;
  stage: Stage;
}

/**
 * 设置 / 替换 / 移除证件照。
 *
 * 为什么单独做成一个能力，而不是复用 export 的 photo 参数：
 * 贴图必须是**任意时间点**都能做的事——用户可能在 intake 阶段就先把照片贴上，
 * 那时还没有任何"导出"的语义。用 export 兼职存照片，语义是错的，
 * 而且会把照片的生命周期绑死在导出动作上（不导出就存不下）。
 *
 * 照片存进 draft 后由宿主 storage 持久化，因此刷新页面也不会丢——
 * 这就是「持图可用」的实现方式。
 */
export function createSetPhotoCapability(
  host: HostServices
): Capability<SetPhotoInput, SetPhotoOutput> {
  return {
    id: "set-photo",
    async run(input: SetPhotoInput, ctx: CallContext): Promise<SetPhotoOutput> {
      const sessionId = sanitizeText(input?.sessionId, 80);
      if (!sessionId) throw new PluginError("E_INPUT_INVALID", "缺少 sessionId");

      const prev = await loadDraft(host, ctx, sessionId);

      // 传空字符串 = 明确移除；不传或非字符串 = 不动
      const clear = typeof input?.photo === "string" && input.photo.trim() === "";
      const photo = clear ? undefined : normalizePhoto(input?.photo);
      const nextPhoto = clear ? undefined : (photo ?? prev.photo);

      const draft = { ...prev, photo: nextPhoto, updatedAt: Date.now() };
      await saveDraft(host, ctx, draft);

      host.telemetry.event("resume.set_photo", {
        action: clear ? "clear" : nextPhoto ? "set" : "noop",
        bytes: nextPhoto ? nextPhoto.length : 0,
      });

      const out: SetPhotoOutput = { hasPhoto: Boolean(nextPhoto), stage: draft.stage };
      if (nextPhoto) out.photo = nextPhoto;
      return out;
    },
  };
}
