import type { CallContext } from "../contract/host.ts";
import type { Capability } from "../contract/plugin.ts";
import type { HostServices } from "../contract/host.ts";
import { PluginError } from "../contract/errors.ts";
import { mergeFacts, type ResumeDraft } from "../model.ts";
import { buildComposeMessages } from "../prompts/compose.ts";
import {
  buildDraft,
  callLlmJson,
  loadDraft,
  sanitizeText,
  saveDraft,
} from "./shared.ts";

export interface ComposeInput {
  sessionId: string;
}

/**
 * 阶段三：成稿。
 *
 * 与 refine 的区别在于「约束强度」：
 * refine 允许留有「（待补充）」占位，compose 则要求删掉空节、只留下有信息量的内容，
 * 产出的是一份可以直接投递的定稿。
 */
export function createComposeCapability(host: HostServices): Capability<ComposeInput, ResumeDraft> {
  return {
    id: "compose",
    async run(input: ComposeInput, ctx: CallContext): Promise<ResumeDraft> {
      const sessionId = sanitizeText(input?.sessionId, 80);
      if (!sessionId) throw new PluginError("E_INPUT_INVALID", "缺少 sessionId");

      const prev = await loadDraft(host, ctx, sessionId);

      // compose 是最重的阶段：既要润色 markdown，又要把润色后的**完整 facts**
      // 一并返回（导出 PDF 用的是 facts）。输出量明显大于 intake / refine，
      // 而"用户粘一份完整简历 → 点生成定稿"恰好就是最需要它的场景。
      // 实测：长输入下 120s 不够，两次都超时。
      const result = await callLlmJson(host, buildComposeMessages(prev.facts), ctx, {
        timeoutMs: 180000,
      });
      const facts = mergeFacts(prev.facts, result.facts);

      const draft = buildDraft({
        sessionId,
        stage: "compose",
        facts,
        markdown: result.markdown,
        // 成稿后就不再push待补清单了，避免用户以为还没完成
        missing: [],
        reply: result.reply || "定稿已生成，接下来可以生成 PDF 简历了。",
        nextQuestion: "",
        photo: prev.photo,
      });

      await saveDraft(host, ctx, draft);
      host.telemetry.event("resume.compose", { completeness: draft.completeness });
      return draft;
    },
  };
}
