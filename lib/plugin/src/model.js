/**
 * 简历数据模型与完整度算法。
 *
 * 一个刻意的分工：**结构化抽取交给大模型，完整度计算留在本地纯函数**。
 * 理由有三：
 *  1. 进度条不会因为模型措辞变化而乱跳，用户体验稳定；
 *  2. 算法可解释、可单测、可向合作方说明打分依据；
 *  3. 省一次 LLM 调用的不确定性，也便于做离线回归。
 */
export const STAGE_ORDER = ["intake", "refine", "compose", "export"];
/** 关键指标最多几条。超过就说明不会取舍——3 条以内 HR 才扫得完。 */
export const MAX_METRICS = 3;
/**
 * 版式原型：决定**哪个板块领跑**。
 *
 * 为什么不照搬模板站的「10 套原型」——
 * 那 10 套里真正的差异其实只有一个维度：**谁排在前面**。
 * 其余差异（配色、双栏、图标、进度条）在**黑白打印**和 **ATS 解析**面前都是负资产：
 * 双栏会让机器读串行，进度条是主观自评，彩色打印出来是一团灰。
 *
 * 所以这里只保留「顺序」这一个变量，3 个就够覆盖绝大多数场景。
 * 加原型 = 加一行数组，不需要写新的渲染器——这才是可维护的扩展方式。
 */
export const ARCHETYPE_ORDER = {
    /** 应届生 / 通用：教育打头，实习紧跟 */
    standard: ["target", "metrics", "education", "experience", "projects", "skills", "awards", "summary"],
    /** 技术 / 研发：技能先亮出来，项目排在实习前（技术岗看项目多于看实习单位） */
    "skill-first": ["target", "metrics", "skills", "education", "projects", "experience", "awards", "summary"],
    /** 项目强于实习：项目提到实习前面，其余不变 */
    "project-first": ["target", "metrics", "education", "projects", "experience", "skills", "awards", "summary"],
};
export const DEFAULT_STYLE = {
    font: "sans",
    density: "normal",
    accent: "#1a1a1a",
    photoShape: "square",
    archetype: "standard",
};
/** 密度从松到紧的顺序，用于「压到一页」时逐档收紧 */
export const DENSITY_ORDER = ["loose", "normal", "compact"];
/** 各模块权重，合计 100。项目/实习经历占比最高，因为它才是简历真正被看的部分。 */
export const MODULE_WEIGHTS = {
    target: 10,
    basics: 10,
    education: 15,
    projects: 25,
    experience: 20,
    skills: 10,
    extras: 10,
};
export const MODULE_LABELS = {
    target: "求职目标",
    basics: "基础信息",
    education: "教育背景",
    projects: "项目经历",
    experience: "实习/工作经历",
    skills: "专业技能",
    extras: "奖项与自我评价",
};
/** 达到该完整度即可进入成稿阶段 */
export const COMPOSE_THRESHOLD = 75;
const DIGIT_RE = /\d/;
function trimmed(v) {
    return typeof v === "string" ? v.trim() : "";
}
function textScore(v, min, ideal) {
    const s = trimmed(v);
    if (!s)
        return 0;
    if (s.length < min)
        return 0.4;
    if (s.length < ideal)
        return 0.8;
    return 1;
}
/** 描述里带数字（“提升 30%”“服务 2000 用户”）的条目占比 —— 量化是简历含金量最直接的信号 */
function quantifiedRatio(items) {
    if (!items || items.length === 0)
        return 0;
    const hit = items.filter((s) => DIGIT_RE.test(s)).length;
    return hit / items.length;
}
function scoreTarget(f) {
    return textScore(f.target, 2, 6);
}
function scoreBasics(f) {
    const b = f.basics ?? {};
    let s = 0;
    if (trimmed(b.name))
        s += 0.4;
    if (trimmed(b.phone) || trimmed(b.email))
        s += 0.3;
    if (trimmed(b.city))
        s += 0.2;
    if (trimmed(b.phone) && trimmed(b.email))
        s += 0.1;
    return Math.min(s, 1);
}
function scoreEducation(f) {
    const list = f.education ?? [];
    if (list.length === 0)
        return 0;
    const e = list[0] ?? {};
    let s = 0;
    if (trimmed(e.school))
        s += 0.35;
    if (trimmed(e.major))
        s += 0.25;
    if (trimmed(e.degree))
        s += 0.15;
    if (trimmed(e.period))
        s += 0.15;
    if (trimmed(e.gpa))
        s += 0.1;
    return Math.min(s, 1);
}
function scoreExperience(f) {
    const list = (f.experience ?? []).filter((x) => trimmed(x.org) || trimmed(x.role));
    if (list.length === 0)
        return 0;
    const coverage = Math.min(list.length, 1);
    const filled = list.filter((x) => trimmed(x.org) && trimmed(x.role) && (x.highlights?.length ?? 0) > 0).length /
        list.length;
    const quant = list.reduce((acc, x) => acc + quantifiedRatio(x.highlights), 0) / list.length;
    return Math.min(0.4 * coverage + 0.35 * filled + 0.25 * quant, 1);
}
function scoreProjects(f) {
    const list = (f.projects ?? []).filter((x) => trimmed(x.name));
    if (list.length === 0)
        return 0;
    // 两个项目即可拿满分覆盖率：再多边际收益递减
    const coverage = Math.min(list.length, 2) / 2;
    const filled = list.filter((x) => trimmed(x.name) && (x.highlights?.length ?? 0) > 0).length / list.length;
    const quant = list.reduce((acc, x) => acc + quantifiedRatio(x.highlights), 0) / list.length;
    return Math.min(0.4 * coverage + 0.35 * filled + 0.25 * quant, 1);
}
function scoreSkills(f) {
    const n = countSkills(f);
    if (n === 0)
        return 0;
    if (n >= 5)
        return 1;
    if (n >= 3)
        return 0.75;
    return 0.4;
}
function scoreExtras(f) {
    let s = 0;
    if ((f.awards ?? []).filter((a) => trimmed(a)).length > 0)
        s += 0.5;
    s += textScore(f.summary, 20, 60) * 0.5;
    return Math.min(s, 1);
}
const SCORERS = {
    target: scoreTarget,
    basics: scoreBasics,
    education: scoreEducation,
    projects: scoreProjects,
    experience: scoreExperience,
    skills: scoreSkills,
    extras: scoreExtras,
};
export function scoreModules(facts) {
    return Object.keys(MODULE_WEIGHTS).map((module) => {
        const score = SCORERS[module](facts);
        const weight = MODULE_WEIGHTS[module];
        return {
            module,
            label: MODULE_LABELS[module],
            score,
            weight,
            earned: Math.round(score * weight * 10) / 10,
        };
    });
}
export function scoreCompleteness(facts) {
    const total = scoreModules(facts).reduce((acc, m) => acc + m.earned, 0);
    return Math.max(0, Math.min(100, Math.round(total)));
}
export function emptyFacts() {
    return { skills: [], projects: [], experience: [], education: [], awards: [] };
}
/**
 * 把模型返回的 skills 归一化成 SkillGroup[]。
 *
 * **必须同时吃两种形状**：
 * - `["SQL", "Python"]` —— 早期版本存的就是这个，老会话里还有
 * - `[{ group: "数据分析", items: ["SQL"] }]` —— 新形状
 * - 混合也行（模型偶尔会漏掉一层）
 *
 * 归一化放在**入口**（coerceFacts）而不是渲染时，这样下游只需要认一种形状。
 * 这就是"在边界处转换，别让两种格式渗进内核"。
 */
export function normalizeSkills(raw) {
    if (!Array.isArray(raw))
        return [];
    const groups = [];
    const seen = new Set();
    const put = (group, item) => {
        const v = trimmed(item);
        if (!v)
            return;
        // 全局去重：同一个技能不该在两个组里各出现一次
        const k = v.toLowerCase();
        if (seen.has(k))
            return;
        seen.add(k);
        let g = groups.find((x) => (x.group ?? "").toLowerCase() === group.toLowerCase());
        if (!g) {
            g = group ? { group, items: [] } : { items: [] };
            groups.push(g);
        }
        g.items.push(v);
    };
    for (const entry of raw) {
        if (typeof entry === "string") {
            put("", entry);
        }
        else if (entry && typeof entry === "object") {
            const e = entry;
            const g = trimmed(e.group);
            if (Array.isArray(e.items))
                for (const it of e.items)
                    put(g, it);
        }
    }
    return groups;
}
/**
 * 技能总条数（跨组求和）。评分和缺口判断都按条数算，不按组数。
 *
 * 自己先归一化一次。理由和渲染层一样：**接 `ResumeFacts` 的公开纯函数都先过一遍**，
 * 别指望"所有调用方都会先归一化"——漏掉一个入口的代价是静默算出 0 分。
 * normalizeSkills 幂等、成本就是一次数组遍历，不值得为省它去赌。
 */
export function countSkills(facts) {
    return normalizeSkills(facts.skills).reduce((n, g) => n + g.items.length, 0);
}
/**
 * 技能合并 = 归一化。
 *
 * 都是"把多份技能列表揉成一份、按组归并、全局去重"，所以直接复用同一个函数——
 * 不为合并再写一套相似的逻辑（那就会有两套去重规则，迟早不一致）。
 *
 * 走合并而不是覆盖，理由和 highlights 一样：
 * 用户上轮说过会 SQL、这轮模型没提，不能因此把 SQL 弄丢。
 */
function mergeSkills(oldGroups, nextGroups) {
    return normalizeSkills([...(oldGroups ?? []), ...(nextGroups ?? [])]);
}
function uniqStrings(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list ?? []) {
        const v = trimmed(raw);
        if (!v)
            continue;
        const k = v.toLowerCase();
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push(v);
    }
    return out;
}
function mergeByKey(oldList, nextList, keyOf) {
    const out = [];
    const index = new Map();
    for (const item of oldList ?? []) {
        const k = keyOf(item);
        if (!k)
            continue;
        if (index.has(k))
            continue;
        index.set(k, { ...item });
        out.push(index.get(k));
    }
    for (const item of nextList ?? []) {
        const k = keyOf(item);
        if (!k)
            continue;
        const existing = index.get(k);
        if (existing) {
            for (const [field, value] of Object.entries(item)) {
                if (value === undefined || value === null)
                    continue;
                if (Array.isArray(value) && value.length === 0)
                    continue;
                if (typeof value === "string" && !value.trim())
                    continue;
                existing[field] = value;
            }
        }
        else {
            const fresh = { ...item };
            index.set(k, fresh);
            out.push(fresh);
        }
    }
    return out;
}
/**
 * 合并模型返回的 facts 与既有 facts。
 * 数组按业务主键匹配（学校/公司/项目名），因此模型每次返回完整对象即可，无需精确 diff，
 * 既容错又能保证「用户前几轮辛苦补充的信息不会因为模型漏写而丢失」。
 */
export function mergeFacts(oldFacts, nextFacts) {
    if (!nextFacts)
        return oldFacts;
    const pick = (next, prev) => {
        const n = trimmed(next);
        return n ? n : trimmed(prev) || undefined;
    };
    const basics = {
        name: pick(nextFacts.basics?.name, oldFacts.basics?.name),
        phone: pick(nextFacts.basics?.phone, oldFacts.basics?.phone),
        email: pick(nextFacts.basics?.email, oldFacts.basics?.email),
        city: pick(nextFacts.basics?.city, oldFacts.basics?.city),
    };
    return {
        target: pick(nextFacts.target, oldFacts.target),
        basics,
        // 合并主键带**回退链**：用户说「实习做过 XX」时往往还没报公司名，
        // 模型会抽出 org 为空的条目——主键只看 org 会把它静默丢弃（实测踩坑：
        // 模型明明抽到了量化成果、reply 还告诉用户「已更新」，数据却在合并层消失）。
        // 回退到 role / highlights 首句：本轮保住新条目；下轮模型再返回同一段经历时
        // 键相同，走字段合并而不是重复。
        education: mergeByKey(oldFacts.education, nextFacts.education, (e) => (trimmed(e.school) || trimmed(e.major) || trimmed(e.period)).toLowerCase()),
        experience: mergeByKey(oldFacts.experience, nextFacts.experience, (e) => (trimmed(e.org) ||
            trimmed(e.role) ||
            trimmed(e.highlights?.[0] ?? "").slice(0, 60)).toLowerCase()),
        projects: mergeByKey(oldFacts.projects, nextFacts.projects, (p) => (trimmed(p.name) ||
            trimmed(p.role) ||
            trimmed(p.highlights?.[0] ?? "").slice(0, 60)).toLowerCase()),
        skills: mergeSkills(oldFacts.skills, nextFacts.skills),
        awards: uniqStrings([...(oldFacts.awards ?? []), ...(nextFacts.awards ?? [])]),
        // 关键指标是**派生数据**（从 highlights 里挑出来的），不是累积数据。
        // 所以规则是「模型给了就替换、没给就保留旧的」，而不是取并集——
        // 并集会让上一轮挑的旧指标永远留在榜上，哪怕它已经不再是最亮的那条。
        //
        // 判据：**累积型数据取并集（信息只会变多），派生型数据用替换（重新算才是对的）。**
        metrics: (nextFacts.metrics ?? []).length > 0
            ? uniqStrings(nextFacts.metrics).slice(0, MAX_METRICS)
            : oldFacts.metrics,
        summary: pick(nextFacts.summary, oldFacts.summary),
    };
}
/** 本地兜底清单：模型没给 missing 时也要有的保底体验 */
export function deriveMissing(facts) {
    const out = [];
    const push = (item) => out.push(item);
    if (!trimmed(facts.target)) {
        push({
            key: "target",
            module: "target",
            label: "你的目标岗位是什么？",
            why: "没有目标岗位，简历无法取舍——同一个经历投产品和投开发，写法完全不同。",
            hint: "例如：Java 后端开发、产品经理、前端开发（应届）",
            priority: "high",
        });
    }
    if (!trimmed(facts.basics?.name) || !trimmed(facts.basics?.phone)) {
        push({
            key: "basics",
            module: "basics",
            label: "姓名和联系方式（手机 / 邮箱）",
            why: "HR 拿到简历第一件事是联系你，缺了就等于白投。",
            hint: "例如：张三 / 138xxxxxxxx / zhangsan@qq.com",
            priority: "high",
        });
    }
    if ((facts.education ?? []).length === 0) {
        push({
            key: "education",
            module: "education",
            label: "你的教育背景：学校、专业、学历、起止时间",
            why: "校招筛简历第一眼看的就是这一栏。",
            hint: "例如：XX大学 / 计算机科学与技术 / 本科 / 2022.09-2026.06",
            priority: "high",
        });
    }
    if ((facts.projects ?? []).length === 0) {
        push({
            key: "projects",
            module: "projects",
            label: "你做过哪些项目？（课程作业、比赛、自己写的小工具都算）",
            why: "项目是学生简历的核心，它证明你会动手，而不只是上过课。",
            hint: "例如：校园二手交易平台，我负责后端接口和数据库设计",
            priority: "high",
        });
    }
    if (countSkills(facts) < 3) {
        push({
            key: "skills",
            module: "skills",
            label: "你掌握哪些技能或工具？",
            why: "技能栏是 JD 关键词匹配率最高的一栏，直接影响能不能过机器筛选。",
            hint: "例如：Java、MySQL、Git、Linux",
            priority: "medium",
        });
    }
    if (!trimmed(facts.summary)) {
        push({
            key: "summary",
            module: "extras",
            label: "用一两句话概括你自己（可选）",
            why: "一段好的自我评价能让面试官在 10 秒内记住你。",
            hint: "例如：三年自学后端开发，独立完成过 3 个上线项目",
            priority: "low",
        });
    }
    const rank = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
const PLACEHOLDER_RE = /[（(]\s*待\s*补\s*充\s*[)）]|待\s*补\s*充/g;
/**
 * 定稿净化：删掉残留的占位文字，以及因此变成空壳的分节。
 *
 * 为什么必须有这一步：提示词里写了「缺内容的模块整节省略」，但模型仍会偶发地
 * 输出「（待补充）」——实测 compose 阶段就出现过。这种硬性约束不该指望模型自觉，
 * 代码兜底才是可靠保证（提示词负责降低发生概率，这里负责保证结果正确）。
 */
export function stripPlaceholders(markdown) {
    const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
    // 1) 去掉占位符本身；只剩符号（如 "- ""、"）的行一并清成空行
    const cleaned = lines.map((raw) => {
        const withoutPlaceholder = raw.replace(PLACEHOLDER_RE, "").replace(/[ \t]+$/, "");
        const bare = withoutPlaceholder.replace(/^[\s\-*·•:：|]+$/, "");
        return bare === "" ? "" : withoutPlaceholder;
    });
    // 2) 丢掉没有正文的分节（连 ## 标题一起删）
    const out = [];
    let i = 0;
    while (i < cleaned.length) {
        if (/^##\s+/.test(cleaned[i])) {
            let j = i + 1;
            while (j < cleaned.length && !/^##\s+/.test(cleaned[j]))
                j++;
            const body = cleaned.slice(i + 1, j);
            if (body.some((l) => l.trim() !== ""))
                out.push(cleaned[i], ...body);
            i = j;
        }
        else {
            out.push(cleaned[i]);
            i++;
        }
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/**
 * 从 facts 渲染 Markdown 文字稿。
 * 用作模型输出异常时的兜底，保证用户任何时候都能看到一份稿子。
 *
 * **板块顺序固定按 `standard`，不跟随 `style.archetype`**——这是刻意的：
 * 版式是**渲染期**的选择（用户随时可以在排版栏里改），而文字稿是**创作期**的工作稿。
 * 让工作稿跟着版式走，就得把 style 一路透传到 intake/refine/compose，
 * 而那几个能力本来和版式无关。**真正的成品是 PDF / 预览，它一定跟随版式。**
 */
export function renderMarkdown(facts, opts) {
    const final = opts?.final === true;
    const L = [];
    const b = facts.basics ?? {};
    // 带标签（电话：/邮箱：）——和 PDF 版一致，一串数字/字母不再需要辨认。
    // 城市在文字稿里只有这里出现（PDF 版在求职意向区），所以保留但同样给标签。
    const contactParts = [
        trimmed(b.phone) ? `电话：${trimmed(b.phone)}` : "",
        trimmed(b.email) ? `邮箱：${trimmed(b.email)}` : "",
        trimmed(b.city) ? `意向城市：${trimmed(b.city)}` : "",
    ].filter(Boolean);
    const contact = contactParts.join(" · ");
    const name = trimmed(b.name);
    if (name)
        L.push(`# ${name}`);
    else if (!final)
        L.push("# （待补充姓名）");
    if (contact)
        L.push(contact);
    if (name || contact)
        L.push("");
    const target = trimmed(facts.target);
    if (target || !final) {
        L.push("## 求职意向");
        L.push(target || "（待补充）");
        L.push("");
    }
    // 关键指标放在最前面（求职意向之后）——它就是给 8 秒扫描用的，
    // 放在后半页就失去意义了。
    const metrics = (facts.metrics ?? []).filter((m) => trimmed(m));
    if (metrics.length > 0) {
        L.push("## 关键指标");
        for (const m of metrics)
            L.push(`- ${trimmed(m)}`);
        L.push("");
    }
    const edu = facts.education ?? [];
    if (edu.length > 0) {
        L.push("## 教育背景");
        for (const e of edu) {
            L.push(`**${trimmed(e.school) || "（待补充学校）"}** ${trimmed(e.major)} ${trimmed(e.degree)}`);
            L.push(`${trimmed(e.period)}${trimmed(e.gpa) ? ` · GPA ${trimmed(e.gpa)}` : ""}`);
            L.push("");
        }
    }
    const exp = facts.experience ?? [];
    if (exp.length > 0) {
        L.push("## 实习 / 工作经历");
        for (const x of exp) {
            L.push(`**${trimmed(x.org)}** ${trimmed(x.role)} ${trimmed(x.period)}`);
            for (const h of x.highlights ?? [])
                L.push(`- ${trimmed(h)}`);
            L.push("");
        }
    }
    const proj = facts.projects ?? [];
    if (proj.length > 0) {
        L.push("## 项目经历");
        for (const p of proj) {
            const stack = (p.stack ?? []).filter((s) => trimmed(s)).join(" / ");
            L.push(`**${trimmed(p.name)}**${trimmed(p.role) ? ` · ${trimmed(p.role)}` : ""} ${trimmed(p.period)}`);
            if (stack)
                L.push(`技术栈：${stack}`);
            for (const h of p.highlights ?? [])
                L.push(`- ${trimmed(h)}`);
            L.push("");
        }
    }
    const skillGroups = (facts.skills ?? []).filter((g) => (g.items ?? []).length > 0);
    if (skillGroups.length > 0) {
        L.push("## 专业技能");
        for (const g of skillGroups) {
            // 组名加粗成行首标签，和 HTML 渲染保持一致（那边用 .sk 类）
            L.push(g.group ? `**${trimmed(g.group)}**：${g.items.join("、")}` : g.items.join("、"));
        }
        L.push("");
    }
    const awards = (facts.awards ?? []).filter((a) => trimmed(a));
    if (awards.length > 0) {
        L.push("## 获奖情况");
        for (const a of awards)
            L.push(`- ${trimmed(a)}`);
        L.push("");
    }
    if (trimmed(facts.summary)) {
        L.push("## 自我评价");
        L.push(trimmed(facts.summary));
        L.push("");
    }
    return L.join("\n").trim();
}
