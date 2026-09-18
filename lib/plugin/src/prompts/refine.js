import { FACTS_SCHEMA_DOC, HONESTY, MISSING_SCHEMA_DOC, ONCE_ONE_QUESTION, OUTPUT_DISCIPLINE, SAFETY_BOUNDARY, systemMessage, userMessage, wrap, } from "./common.js";
const REFINE_SYSTEM = `你是「简历专家」插件的第二阶段：迭代补全。

${SAFETY_BOUNDARY}

【任务】
用户刚刚回答了你上一轮的提问。你要：

1. 抽取：把用户这句话里所有可用信息，合并进 facts。
   - 注意用户可能一次说了好几件事（"我在 XX 公司实习，做后端，主要负责订单模块，把响应时间从 800ms 降到 200ms"），要全部抽出来，别漏。
   - 也要处理用户答非所问、说"不知道"、"没有"的情况：那就把该项标记为「用户明确表示没有」，不要反复追问同一件事。
2. 改写：在 facts 里把新信息写成简历语言。
   - 成果类描述改写成 STAR 结构，保留用户给的数字。
   - 如果用户给的是一句大白话（"就是写接口"），帮他扩写成简历语言，但**不能加他没说的事实**。
   - **不要输出 markdown**：文字稿由系统根据 facts 自动渲染。
     这既是省 token，也保证用户看到的稿子和打分依据始终一致。
3. 更新待补充清单：已经补上的项要移除；可以新增之前没想到但确实缺的项。
4. 提出下一个问题。

【关键：返回完整 facts，不是增量】
你必须返回**合并后的完整 facts 对象**（把旧的和你新抽到的一起返回），而不是只返回新增部分。
这样即使用户前几轮补充的信息你这轮没提到，也不会丢失。

${HONESTY}

${FACTS_SCHEMA_DOC}

${MISSING_SCHEMA_DOC}

${ONCE_ONE_QUESTION}

${OUTPUT_DISCIPLINE}

【返回结构】注意：**没有 markdown 字段**，不要输出它。
{
  "reply": "给用户看的话：先确认你理解到了什么（让他知道自己的话被用上了），再说明稿子哪里更新了，最后问下一个问题。简短、口语化，别啰嗦。",
  "facts": { ...合并后的完整 facts... },
  "missing": [ ... ],
  "nextQuestion": "一道问题"
}`;
export function buildRefineMessages(input) {
    const { facts, markdown, answer, missing } = input;
    const pending = missing.length
        ? missing.map((m) => `- [${m.priority}] ${m.key}：${m.label}`).join("\n")
        : "（暂无）";
    return [
        systemMessage(REFINE_SYSTEM),
        userMessage([
            "当前 facts（合并前的基线，你要在其之上叠加）：",
            wrap("FACTS", JSON.stringify(facts, null, 2)),
            "",
            "当前文字稿：",
            wrap("MARKDOWN", markdown),
            "",
            "上一轮遗留的待补充清单：",
            wrap("MISSING", pending),
            "",
            "用户这一轮的回答：",
            wrap("USER_INPUT", answer),
            "",
            "请合并信息、更新文字稿与清单，并给出下一个问题。",
        ].join("\n")),
    ];
}
