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
                            // 插件申请多少由它决定，但模型能吐多少是宿主的领域知识——在这里钳制
                            max_tokens: Math.min(opts?.maxTokens ?? 4096, cfg.maxTokens ?? 16384),
                            // SenseNova 专用参数；DeepSeek 侧 cfg.reasoningEffort 不传值，此分支不生效
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
                        console.warn(`[resume-expert] 模型${isAbort ? "超时" : "连接失败"}，退避重试：${msg}`);
                        await sleep((isAbort ? 2000 : 1500) * (attempt + 1));
                        continue;
                    }
                    throw e;
                }
                if (resp.status === 429) {
                    if (attempt < retries) {
                        // 服务端给 Retry-After 就听它的；没给就退 15 秒。
                        // Retry-After > 90s 说明是用量配额打满（小时级/天级窗口），重试无意义，立刻失败
                        const ra = Number(resp.headers.get("retry-after"));
                        if (Number.isFinite(ra) && ra > 90) {
                            throw new Error(`429 模型服务被限流：服务端要求等待 ${Math.round(ra)}s（通常是用量配额已达上限，需等窗口重置）`);
                        }
                        const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 15000;
                        console.warn(`[resume-expert] 模型限流 429，退避 ${Math.round(waitMs / 1000)}s 后重试`);
                        await sleep(waitMs);
                        continue;
                    }
                    throw new Error("429 模型服务被限流");
                }
                // 401/403 = key 无效/未授权，单独报——用户要能判断「该不该换 key」
                if (resp.status === 401 || resp.status === 403) {
                    throw new Error(`模型服务认证失败（HTTP ${resp.status}）——API Key 无效、过期或未开通该模型`);
                }
                if (!resp.ok)
                    throw new Error(`模型服务返回 HTTP ${resp.status}`);
                const text = await resp.text();
                let data;
                try {
                    data = JSON.parse(text);
                }
                catch {
                    throw new Error("模型返回的不是 JSON");
                }
                const choice = data?.choices?.[0];
                const content = (choice?.message?.content || choice?.message?.reasoning_content || "").trim();
                // 空内容不是"内容"，是失败——不能伪装成一段文本放过去
                if (!content) {
                    throw new Error(`模型返回空内容（finish_reason=${choice?.finish_reason ?? "未知"}）`);
                }
                return content;
            }
            throw new Error("模型服务繁忙");
        },
    };
}
