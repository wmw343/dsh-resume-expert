import {
  ARCHETYPE_ORDER,
  DENSITY_ORDER,
  DEFAULT_STYLE,
  MAX_METRICS,
  normalizeSkills,
  type ResumeDensity,
  type ResumeFacts,
  type ResumeFont,
  type ResumeStyle,
} from "./model.ts";

/**
 * 样式白名单校验。
 *
 * **放在渲染层而不是只在 export 能力里**，是刻意的防御性设计：
 * 这些值会被直接拼进 `<style>`，而 `renderResumeHtml` 是对外导出的公共函数，
 * 宿主可能绕过 export 直接调用它。校验跟着渲染走，才能保证「无论谁调都安全」。
 */
export function normalizeStyle(input?: Partial<ResumeStyle>): ResumeStyle {
  const merged: ResumeStyle = { ...DEFAULT_STYLE, ...(input ?? {}) };
  if (!DENSITY_ORDER.includes(merged.density)) merged.density = DEFAULT_STYLE.density;
  if (merged.font !== "sans" && merged.font !== "serif") merged.font = DEFAULT_STYLE.font;
  if (merged.photoShape !== "square" && merged.photoShape !== "round") {
    merged.photoShape = DEFAULT_STYLE.photoShape;
  }
  // 只接受 #rgb / #rrggbb —— 否则 'red; } body { background: url(...)' 能逃逸出去
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(merged.accent)) {
    merged.accent = DEFAULT_STYLE.accent;
  }
  if (!(merged.archetype in ARCHETYPE_ORDER)) merged.archetype = DEFAULT_STYLE.archetype;
  return merged;
}

/**
 * 简历 HTML 渲染。
 *
 * 一个刻意的选择：**不解析 Markdown，直接从结构化 facts 渲染**。
 * 理由：PDF 的版式（分页、对齐、字号层级）必须由结构决定，
 * 依赖 Markdown 反推布局会在换行、缩进上失控。
 */

const FONT_STACKS: Record<ResumeFont, string> = {
  // 黑体系：现代、屏幕上更清晰，适合互联网/产品岗
  sans: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", system-ui, sans-serif',
  // 宋体系：传统、正式，适合金融/国企/考公方向
  serif: '"Songti SC", "SimSun", "Noto Serif CJK SC", Georgia, serif',
};

/**
 * 三档密度。
 *
 * 单一 `--rx-scale` 缩放是行不通的：字号、行距、段间距、页边距需要**各自**的比例
 * 才能在收紧时保持层次感。所以给每档一组完整参数，而不是一个倍率。
 * `pad` 是页边距——它同时是「压到一页」最有效的手段。
 */
const DENSITY_METRICS: Record<
  ResumeDensity,
  { font: string; lh: string; padV: string; padH: string; seg: string; item: string; h1: string; h2: string }
> = {
  compact: { font: "9.6pt", lh: "1.42", padV: "10mm", padH: "12mm", seg: "2.8mm", item: "1.8mm", h1: "17pt", h2: "10.5pt" },
  normal: { font: "10.5pt", lh: "1.62", padV: "14mm", padH: "15mm", seg: "4mm", item: "2.6mm", h1: "19pt", h2: "11.5pt" },
  loose: { font: "11.6pt", lh: "1.82", padV: "18mm", padH: "18mm", seg: "5.5mm", item: "3.6mm", h1: "21.5pt", h2: "12.5pt" },
};

export interface RenderResumeOptions {
  /** 证件照 data URL */
  photo?: string;
  /** 排版样式；缺省字段用 DEFAULT_STYLE 补齐 */
  style?: ResumeStyle;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 行内标记：把 `**加粗**` 转成 `<strong>`。
 *
 * 简历里加粗关键数字是刚需——教育部的规范和 10 套高赞模板**无一例外**都这么做。
 *
 * ⚠️ **转义顺序不能反，这是安全红线：**
 * 必须「先 esc() 把用户内容里的尖括号全部变成实体」→「再插入我们自己生成的 <strong>」。
 *
 * 反过来（先插标签、再整体转义）会把 `<strong>` 自己也转义掉，加粗失效；
 * 而如果有人想绕过转义，`<script>` 已经在第一步变成 `&lt;script&gt;` 了，注入不进来。
 * 换句话说：**这个顺序同时保证了「功能对」和「注入不进来」**。
 */
function mdInline(s: unknown): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * 纯文本场景（`<title>` 这类）：**去掉 \`**\` 标记，而不是转成 `<strong>`**。
 *
 * 因为它们的内容不按 HTML 渲染——塞进 `<strong>` 反而会把标签当成字面文字印出来。
 * 所以这里是"遇到标记就丢掉"，和 mdInline 的目的不同，不能混用。
 *
 * 第三种情况的存在说明：**"渲染文本"其实有三种去处**——
 * ① 能放标签的正文（mdInline）② 不能放标签的纯文本（plainText）③ 属性值（esc）。
 */
function plainText(s: unknown): string {
  return esc(String(s ?? "").replace(/\*\*/g, ""));
}

function has(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function seg(title: string, inner: string): string {
  if (!inner.trim()) return "";
  return `<section class="seg"><h2>${esc(title)}</h2>${inner}</section>`;
}

function bullets(items: string[] | undefined): string {
  const list = (items ?? []).filter(has);
  if (list.length === 0) return "";
  return `<ul>${list.map((i) => `<li>${mdInline(i)}</li>`).join("")}</ul>`;
}

/**
 * 全篇唯一的并列分隔符。
 *
 * 这一条被返工过两次，值得写清楚：
 *
 * 第一版是联系方式用 `·`、技能栏用 `｜`，同一份文档两套符号。
 * 第二版抽出了这个函数——但**只统一了两处，漏了教育行（字面量 `" · "`）
 * 和项目技术栈（`" / "`）**，视觉上依然不齐。用户一眼就看了出来。
 *
 * 教训：抽函数不等于统一。**必须把所有并列场景都走这个出口，
 * 否则"统一机制"只是自我感觉良好。** 现在全篇只有这一个拼接入口。
 *
 * 间距 1.8mm：太宽会让技能栏那种多条目行更容易折行，太窄又看不出分隔。
 * 颜色 #999 而不是 #bbb —— #bbb 在 A4 白纸上几乎印不出来，
 * 用户会觉得"这一行没做完"。
 */
function joinInline(items: string[]): string {
  return items.filter(has).map((i) => mdInline(i)).join('<span class="dot">·</span>');
}

export function renderResumeHtml(facts: ResumeFacts, opts?: RenderResumeOptions): string {
  const style = normalizeStyle(opts?.style);
  const photo = opts?.photo;
  const m = DENSITY_METRICS[style.density] ?? DENSITY_METRICS.normal;

  const b = facts.basics ?? {};
  // 联系行**只放「怎么联系我」**。城市是「我想去哪」，语义不同，挪进求职意向——
  // 挤在一行会让「杭州 / 上海 / 深圳」读起来像漫无目的的海投。
  //
  // 每项带「电话：」「邮箱：」标签——一串数字和一串字母不再需要辨认，
  // HR 和 ATS 都能直接读出语义。标签用 .lbl 灰色降权（字号不缩：规范要求字号统一，
  // 降低视觉权重该靠颜色）。每项独立 .ci，分隔符独立 .dot，
  // 配合 .contact 的 flex + gap，项间距由布局机械化保证（见下方 CSS）。
  const contactItems = [
    has(b.phone) ? `<span class="ci"><span class="lbl">电话：</span>${mdInline(b.phone)}</span>` : "",
    has(b.email) ? `<span class="ci"><span class="lbl">邮箱：</span>${mdInline(b.email)}</span>` : "",
  ].filter(Boolean);
  const contactLine = contactItems.join('<span class="dot">·</span>');

  const photoBlock = photo
    ? `<div class="photo"><img src="${esc(photo)}" alt="证件照" /></div>`
    : "";

  const head = `<header class="head">
    <div class="who">
      <h1>${mdInline(has(b.name) ? b.name : "姓名")}</h1>
      ${contactLine ? `<p class="contact">${contactLine}</p>` : ""}
    </div>
    ${photoBlock}
  </header>`;

  const edu = (facts.education ?? [])
    .filter((e) => has(e.school) || has(e.major))
    .map(
      (e) => `<div class="item">
      <div class="item-head">
        <span class="org">${mdInline(e.school)}</span>
        <span class="when">${joinInline([e.degree ?? "", e.major ?? ""])}${
          has(e.period) ? `　${mdInline(e.period)}` : ""
        }</span>
      </div>
      ${has(e.gpa) ? `<div class="meta">GPA ${mdInline(e.gpa)}</div>` : ""}
    </div>`
    )
    .join("");

  const exp = (facts.experience ?? [])
    .filter((x) => has(x.org) || has(x.role))
    .map(
      (x) => `<div class="item">
      <div class="item-head">
        <span class="org">${mdInline(x.org)}</span>
        <span class="when">${mdInline(x.role)}${has(x.period) ? `　${mdInline(x.period)}` : ""}</span>
      </div>
      ${bullets(x.highlights)}
    </div>`
    )
    .join("");

  const proj = (facts.projects ?? [])
    .filter((p) => has(p.name))
    .map(
      (p) => `<div class="item">
      <div class="item-head">
        <span class="org">${mdInline(p.name)}</span>
        <span class="when">${mdInline(p.role)}${has(p.period) ? `　${mdInline(p.period)}` : ""}</span>
      </div>
      ${
        (p.stack ?? []).filter(has).length
          ? `<div class="meta">技术栈：${joinInline(p.stack ?? [])}</div>`
          : ""
      }
      ${bullets(p.highlights)}
    </div>`
    )
    .join("");

  // 技能按组渲染：每组一行，组名做行首标签。
  // 教育部规范要求技能"写具体"，10 套模板的技术栈/技能栏也都是分组的——
  // 一行平铺 8 个技能，HR 根本扫不完。
  //
  // 这里**再归一化一次**（入口已经做过）：渲染器是最后一道防线。
  // 早期版本存进宿主 storage 的是 string[]，老会话读出来形状就是旧的；
  // normalizeSkills 是幂等的，重复调用无害，却能免掉一次数据迁移。
  const skillGroups = normalizeSkills(facts.skills).filter((g) => (g.items ?? []).length > 0);

  /**
   * 各板块的 HTML，按 id 存起来。
   *
   * 先全部渲染好、再按 `ARCHETYPE_ORDER` 排序拼装——而不是在模板里写死顺序。
   * 这样**加一个版式原型只需要在 `ARCHETYPE_ORDER` 里加一行数组**，
   * 不用动这里的任何一块，也就不可能出现"漏改一处导致某个原型少一节"。
   */
  const blocks: Record<string, string> = {
    target: seg(
      "求职意向",
      [
        has(facts.target) ? `<p class="plain">${mdInline(facts.target)}</p>` : "",
        has(b.city) ? `<p class="plain">意向城市：${mdInline(b.city)}</p>` : "",
      ].join("")
    ),
    metrics: seg("关键指标", bullets((facts.metrics ?? []).slice(0, MAX_METRICS))),
    education: seg("教育背景", edu),
    experience: seg("实习 / 工作经历", exp),
    projects: seg("项目经历", proj),
    skills: seg(
      "专业技能",
      skillGroups
        .map((g) =>
          g.group
            ? `<p class="plain"><span class="sk">${mdInline(g.group)}</span>：${joinInline(g.items)}</p>`
            : `<p class="plain">${joinInline(g.items)}</p>`
        )
        .join("")
    ),
    awards: seg("获奖情况", bullets(facts.awards)),
    summary: seg("自我评价", has(facts.summary) ? `<p class="plain">${mdInline(facts.summary)}</p>` : ""),
  };

  const ordered = ARCHETYPE_ORDER[style.archetype].map((id) => blocks[id] ?? "").join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${plainText(has(b.name) ? `${b.name}的简历` : "简历")}</title>
<style>
  @page { size: A4; margin: ${m.padV} ${m.padH}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #1a1a1a; background: #fff;
    font-family: ${FONT_STACKS[style.font] ?? FONT_STACKS.sans};
    font-size: ${m.font}; line-height: ${m.lh};
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 6mm 0; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12mm;
          border-bottom: 1.5pt solid ${style.accent}; padding-bottom: 3mm; margin-bottom: ${m.seg}; }
  .who { flex: 1 1 auto; min-width: 0; }
  h1 { font-size: ${m.h1}; margin: 0 0 1.5mm; letter-spacing: 1pt; font-weight: 600; }
  /* 联系行：flex + gap 让「电话与邮箱之间」「换行后的行间」间距全部机械化统一；
     baseline 对齐保证数字（电话）与字母（邮箱）的视觉基线一致。
     间距值与全局 .dot 的 1.8mm 对齐，视觉上和正文的分隔符完全一致。 */
  .contact { margin: 1.2mm 0 0; color: #444; display: flex; flex-wrap: wrap;
             align-items: baseline; column-gap: 1.8mm; row-gap: 0.8mm; line-height: 1.35; }
  .contact .dot { margin: 0; }
  /* 标签（电话：/邮箱：）灰色降权——字号不缩，规范要求字号统一 */
  .contact .lbl { color: #888; }
  .dot { margin: 0 1.8mm; color: #999; }
  /* 加粗要"重"得起来：600 + 纯黑。默认的 bold + 承袭的灰黑色在 A4 上不够跳。 */
  strong { font-weight: 600; color: #000; }
  /* 技能组的行首标签。不用 <strong> —— 那个语义已经留给"关键数字"了，
     两者在纸面上都是 600 字重，但来源不同，类名分开以后好各自调整。 */
  .sk { font-weight: 600; }
  .photo { width: 26mm; height: 34mm; flex: 0 0 auto; overflow: hidden;
           border: 0.5pt solid #ddd; border-radius: ${style.photoShape === "round" ? "2mm" : "0"}; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .seg { margin-top: ${m.seg}; page-break-inside: auto; }
  h2 { font-size: ${m.h2}; margin: 0 0 2mm; padding-left: 2.6mm; font-weight: 600;
       border-left: 3pt solid ${style.accent}; color: ${style.accent};
       letter-spacing: .4pt; page-break-after: avoid; }
  .item { margin-bottom: ${m.item}; page-break-inside: avoid; }
  .item-head { display: flex; justify-content: space-between; gap: 6mm; align-items: baseline; }
  .org { font-weight: 600; }
  .when { color: #555; font-size: .9em; white-space: nowrap; }
  .meta { color: #555; font-size: .9em; margin-top: .6mm; }
  ul { margin: 1mm 0 0; padding-left: 4.6mm; }
  li { margin-bottom: .8mm; }
  .plain { margin: 0; }
  @media print { .sheet { padding: 0; max-width: none; } }
</style>
</head>
<body>
<div class="sheet">
${head}
${ordered}
</div>
</body>
</html>`;
}
