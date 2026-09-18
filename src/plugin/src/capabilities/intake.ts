import type { CallContext } from "../contract/host.ts";
import type { Capability } from "../contract/plugin.ts";
import type { HostServices } from "../contract/host.ts";
import { PluginError } from "../contract/errors.ts";
import { emptyFacts, mergeFacts, type ResumeDraft } from "../model.ts";
import { buildIntakeMessages } from "../prompts/intake.ts";
import {
  MAX_INPUT,
  buildDraft,
  callLlmJson,
  looksLikeOverride,
  newSessionId,
  sanitizeText,
  saveDraft,
} from "./shared.ts";

export interface IntakeInput {
  raw: string;
  sessionId?: string;
}

/**
 * 阶段一：首轮诊断与文字稿。
 *
 * 这是整个插件的入口，也是最容易被做错的一步——
 * 用户此时往往只会说一句"帮我做份简历"，插件如果直接吐一份空模板，用户当场就流失了。
 * 所以这里的产出刻意做成三件套：诊断（教他简历该有什么）+ 文字稿（让他看到成品形态）+ 一个追问。
 */
export function createIntakeCapability(host: HostServices): Capability<IntakeInput, ResumeDraft> {
  return {
    id: "intake",
    async run(input: IntakeInput, ctx: CallContext): Promise<ResumeDraft> {
      const raw = sanitizeText(input?.raw, MAX_INPUT);
      if (!raw) throw new PluginError("E_INPUT_INVALID", "输入为空");
      if (looksLikeOverride(raw)) throw new PluginError("E_INPUT_INVALID", "输入包含疑似指令内容");
      if (typeof input?.raw === "string" && input.raw.length > MAX_INPUT) {
        throw new PluginError("E_INPUT_TOO_LONG");
      }

      const sessionId = input?.sessionId?.trim() || newSessionId();

      const result = await callLlmJson(host, buildIntakeMessages(raw), ctx);
      const facts = mergeFacts(emptyFacts(), result.facts);

      const draft = buildDraft({
        sessionId,
        stage: "intake",
        facts,
        // 文字稿一律由本地从 facts 渲染（传空字符串即走兜底渲染）。
        // 不让模型输出它，是为了避免「同一批信息输出两遍」把 token 预算吃掉一半——
        // 长简历输入时这会把 JSON 直接截断（实测 finish_reason=length）。
        // 附带好处：用户看到的稿子与完整度打分依据永远来自同一份数据。
        markdown: "",
        missing: result.missing.length > 0 ? result.missing : undefined,
        reply: result.reply,
        nextQuestion: result.nextQuestion,
      });

      await saveDraft(host, ctx, draft);
      host.telemetry.event("resume.intake", {
        completeness: draft.completeness,
        missingCount: draft.missing.length,
      });
      return draft;
    },
  };
}
