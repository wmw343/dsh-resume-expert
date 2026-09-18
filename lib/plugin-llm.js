import { PluginError } from "./plugin/src/contract/errors.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
export function createRealLlm(cfg) {
    return {
        async complete(messages, opts) {
            const retries = opts?.retries ?? 1;
            const timeoutMs = opts?.timeoutMs ?? 45000;
            for (let attempt = 0; attempt <= retries; attempt++) {
                let resp;
                // 连接层失败（被网关断开 / DNS / 连接超时）在这里退避重试。
                // 它属于传输层问题，该由宿主负责——插件只承诺「给我一段补全」。
                // 实测漏掉这一层时，密集调用会偶发 fetch failed，
                // 一路冒到用户面前变成「出现未知错误」。
                // 超时（TimeoutError）同样值得重试：白天高峰服务端排队，
                // 一个窗口过去第二次常常就通了——这是「经常性超时」的主要场景。
                try {
                    resp = await fetch(cfg.baseUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${cfg.apiKey}`,
                        },
                        body: JSON.stringify({
                            model: cfg.model,
                            messages,
                            temperature: opts?.temperature ?? 0.7,
                            // 插件申请多少由它决定（它知道自己要输出多长），
                            // 但**模型能吐多少是宿主的领域知识**——在这里钳制，
                            // 换模型时只改配置，插件一行都不用动。
                            max_tokens: Math.min(opts?.maxTokens ?? 4096, cfg.maxTokens ?? 16384),
                            // 思考强度由宿主配置注入（未配置则用服务端默认）。
                            // 这是模型相关参数，按上面 max_tokens 同样的理由放在宿主侧。
                            ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
                        }),
                        // 超时与用户取消（ctx.signal）叠加：谁先到算谁的
                        signal: opts?.signal
                            ? AbortSignal.any([AbortSignal.timeout(timeoutMs), opts.signal])
                            : AbortSignal.timeout(timeoutMs),
                    });
                }
                catch (e) {
                    // 用户主动取消：立即放弃，绝不重试
                    if (opts?.signal?.aborted)
                        throw e;
                    const msg = e instanceof Error ? e.message : String(e);
                    const name = e?.name;
                    const isAbort = /abort/i.test(msg) || name === "TimeoutError" || name === "AbortError";
                    if (attempt < retries) {
                        console.warn(`[host] 模型${isAbort ? "超时" : "连接失败"}，退避重试：${msg}`);
                        await sleep((isAbort ? 2000 : 1500) * (attempt + 1));
                        continue;
                    }
                    // 这里刻意**原样抛出**（不包成 PluginError）：这几个是 Node/fetch 自己生成的
                    // 传输层错误（"fetch failed" / TimeoutError…），文案不受接入方影响，
                    // 插件的关键词兜底能稳定认出；而且原样抛能保住 cause 链，
                    // 插件可从 cause.code（ECONNRESET 等）取到更具体的诊断信息。
                    throw e;
                }
                if (resp.status === 429) {
                    if (attempt < retries) {
                        // 服务端给了 Retry-After 就听它的；没给就退 15 秒（限流窗口按分钟计，
                        // 8 秒以内的退避常常跨不过窗口，等于没退避）。
                        // 但 Retry-After 大于 90s 说明是**用量配额**打满（要等小时级/天级窗口），
                        // 重试也是白打——立刻失败并把原因说清楚。
                        const ra = Number(resp.headers.get("retry-after"));
                        if (Number.isFinite(ra) && ra > 90) {
                            throw new PluginError("E_LLM_BUSY", `服务端要求等待 ${Math.round(ra)}s（用量配额可能已达上限，需等窗口重置）`);
                        }
                        const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 15000;
                        console.warn(`[host] 模型限流 429，退避 ${Math.round(waitMs / 1000)}s 后重试`);
                        await sleep(waitMs);
                        continue;
                    }
                    throw new PluginError("E_LLM_BUSY", "429 限流");
                }
                // 401/403 是「key 无效/未授权」——必须从一票 HTTP 错误里单拎出来，
                // 否则用户没法判断「该不该换 key」。
                if (resp.status === 401 || resp.status === 403) {
                    throw new PluginError("E_LLM_AUTH", `HTTP ${resp.status}`);
                }
                if (!resp.ok)
                    throw new PluginError("E_UNKNOWN", `模型服务返回 HTTP ${resp.status}`);
                const text = await resp.text();
                let data;
                try {
                    data = JSON.parse(text);
                }
                catch {
                    throw new PluginError("E_LLM_BAD_RESPONSE", "模型返回的不是 JSON");
                }
                const choice = data?.choices?.[0];
                const content = (choice?.message?.content || choice?.message?.reasoning_content || "").trim();
                // 空内容不是"内容"，是失败。
                // 早期这里返回占位字符串 "（未返回内容）"，结果调用方把故障当成了结果——
                // tailor 因此产出过一份只有 7 个字的"简历"，而且一路绿灯通过类型校验。
                // 失败必须在适配层就暴露成异常，不能伪装成一段文本。
                if (!content) {
                    throw new PluginError("E_LLM_BAD_RESPONSE", `模型返回空内容（finish_reason=${choice?.finish_reason ?? "未知"}）`);
                }
                return content;
            }
            throw new PluginError("E_LLM_BUSY", "重试次数已用尽");
        },
    };
}
