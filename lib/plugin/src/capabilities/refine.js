import { PluginError } from "../contract/errors.js";
import { COMPOSE_THRESHOLD, mergeFacts } from "../model.js";
import { buildRefineMessages } from "../prompts/refine.js";
import { MAX_INPUT, buildDraft, callLlmJson, loadDraft, looksLikeOverride, sanitizeText, saveDraft, } from "./shared.js";
/**
 * 阶段二：迭代补全。
 *
 * 每一轮都做四件事：抽取新事实 → 重写文字稿 → 更新待补清单 → 提一个问题。
 * 「一次只问一个问题」是刻意保留的产品纪律：一次抛多个问题会显著拉低回答率。
 */
export function createRefineCapability(host) {
    return {
        id: "refine",
        async run(input, ctx) {
            const sessionId = sanitizeText(input?.sessionId, 80);
            if (!sessionId)
                throw new PluginError("E_INPUT_INVALID", "缺少 sessionId");
            const answer = sanitizeText(input?.answer, MAX_INPUT);
            if (!answer)
                throw new PluginError("E_INPUT_INVALID", "回答为空");
            if (looksLikeOverride(answer))
                throw new PluginError("E_INPUT_INVALID", "回答包含疑似指令内容");
            const prev = await loadDraft(host, ctx, sessionId);
            const result = await callLlmJson(host, buildRefineMessages({
                facts: prev.facts,
                markdown: prev.markdown,
                answer,
                missing: prev.missing,
            }), ctx);
            // 模型返回的是「合并后的完整 facts」，但依然走一次本地合并兜底：
            // 它偶发漏字段时，用户前几轮补充的信息不会丢。
            const facts = mergeFacts(prev.facts, result.facts);
            const draft = buildDraft({
                sessionId,
                stage: "refine",
                facts,
                // 同 intake：文字稿由本地从 facts 渲染，不让模型重复输出一遍
                markdown: "",
                // 模型没给出有效清单时回落到本地兜底；给出清单时以它为准
                missing: result.missing.length > 0 ? result.missing : undefined,
                reply: result.reply,
                nextQuestion: result.nextQuestion,
                photo: prev.photo,
            });
            // 达到阈值时由代码补一句提示，而不是指望模型每次都记得说
            if (draft.completeness >= COMPOSE_THRESHOLD && draft.missing.length === 0) {
                draft.reply = `${draft.reply}\n\n信息已经比较完整了，可以直接生成定稿，也可以继续补充细节。`;
            }
            await saveDraft(host, ctx, draft);
            host.telemetry.event("resume.refine", {
                completeness: draft.completeness,
                missingCount: draft.missing.length,
            });
            return draft;
        },
    };
}
