/**
 * 简历专家 · 工作台 Widget（框架无关）
 *
 * 这里是刻意的设计选择：**界面本身也是插件的一部分**。
 * 宿主只需要给一个空容器：
 *
 *   const instance = resumeExpertPlugin.create(hostServices);
 *   const mod = await instance.widget("resume-expert.main")();
 *   const unmount = mod.mount(container, { plugin: instance, host, ctx });
 *
 * 插件不依赖 React / Vue，任何工作台都能挂载；宿主想要自定义皮肤时，
 * 也可以只调用 capability 层，把 UI 完全换成自己的。
 */
import { mdToHtml } from "./md.js";
const STYLE_ID = "resume-expert-style";
const CSS = `
.rx, .rx * { box-sizing: border-box; }
.rx {
  --rx-bg: #f6f6f3;
  --rx-panel: #ffffff;
  --rx-line: #e4e3de;
  --rx-line-strong: #d2d1cb;
  --rx-ink: #1f1f1c;
  --rx-ink-2: #55554f;
  --rx-ink-3: #8b8a83;
  --rx-accent: #1d6f5c;
  --rx-accent-soft: #eaf2ef;
  --rx-warn: #9a6a1a;
  --rx-warn-soft: #fbf3e2;
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr);
  height: 100%; min-height: 640px; background: var(--rx-panel); color: var(--rx-ink);
  border: 1px solid var(--rx-line); border-radius: 12px; overflow: hidden;
  font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
  font-size: 13px; line-height: 1.6;
}
.rx-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.rx-col--chat { border-right: 1px solid var(--rx-line); background: var(--rx-bg); }

.rx-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px;
  border-bottom: 1px solid var(--rx-line); background: var(--rx-panel); flex: 0 0 auto; }
.rx-brand { font-size: 14px; font-weight: 600; letter-spacing: .3px; }
.rx-brand small { display: block; font-size: 11px; font-weight: 400; color: var(--rx-ink-3); letter-spacing: 0; }
.rx-progress { margin-left: auto; display: flex; align-items: center; gap: 9px; min-width: 180px; }
.rx-progress .lbl { font-size: 11px; color: var(--rx-ink-3); white-space: nowrap; }
.rx-bar { flex: 1; height: 5px; border-radius: 3px; background: #e9e8e3; overflow: hidden; }
.rx-bar i { display: block; height: 100%; width: 0; background: var(--rx-accent);
  transition: width .45s cubic-bezier(.2,.7,.3,1); }
.rx-pct { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--rx-ink-2); min-width: 34px; text-align: right; }

.rx-msgs { flex: 1 1 auto; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.rx-msg { max-width: 92%; }
.rx-msg .who { font-size: 11px; color: var(--rx-ink-3); margin-bottom: 4px; }
.rx-msg .body { padding: 10px 13px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; }
.rx-msg--agent { align-self: flex-start; }
.rx-msg--agent .body { background: var(--rx-panel); border: 1px solid var(--rx-line); }
.rx-msg--user { align-self: flex-end; }
.rx-msg--user .who { text-align: right; }
.rx-msg--user .body { background: var(--rx-accent); color: #fff; }
.rx-msg--err .body { background: #fdeeee; border: 1px solid #f0cccc; color: #8d2b2b; }

.rx-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 18px 14px; }
.rx-chip { border: 1px solid var(--rx-line-strong); background: var(--rx-panel); border-radius: 999px;
  padding: 6px 12px; font-size: 12px; color: var(--rx-ink-2); cursor: pointer; font-family: inherit; }
.rx-chip:hover { border-color: var(--rx-accent); color: var(--rx-accent); }

.rx-missing { flex: 0 0 auto; max-height: 168px; overflow-y: auto; border-top: 1px solid var(--rx-line);
  background: var(--rx-warn-soft); padding: 12px 18px; }
.rx-missing h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--rx-warn); }
.rx-missing ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
.rx-missing li { font-size: 12px; }
.rx-missing .q { color: var(--rx-ink); }
.rx-missing .why { color: var(--rx-ink-3); font-size: 11px; }
.rx-missing .tag { display: inline-block; font-size: 10px; padding: 0 5px; border-radius: 4px;
  background: #f0e3c4; color: var(--rx-warn); margin-right: 6px; vertical-align: 1px; }

.rx-form { flex: 0 0 auto; border-top: 1px solid var(--rx-line); background: var(--rx-panel); padding: 12px 14px; }
.rx-form textarea { width: 100%; min-height: 62px; max-height: 160px; resize: vertical; padding: 9px 11px;
  border: 1px solid var(--rx-line-strong); border-radius: 8px; font-family: inherit; font-size: 13px;
  line-height: 1.6; color: var(--rx-ink); outline: none; }
.rx-form textarea:focus { border-color: var(--rx-accent); }
.rx-form .row { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
.rx-btn { border: 1px solid var(--rx-line-strong); background: var(--rx-panel); color: var(--rx-ink);
  border-radius: 8px; padding: 7px 14px; font-size: 12.5px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.rx-btn:hover:not(:disabled) { border-color: var(--rx-ink-3); }
.rx-btn:disabled { opacity: .45; cursor: not-allowed; }
.rx-btn--primary { background: var(--rx-accent); border-color: var(--rx-accent); color: #fff; }
.rx-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }
.rx-hint { font-size: 11px; color: var(--rx-ink-3); margin-left: auto; }

.rx-photochip { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px;
  color: var(--rx-accent); background: var(--rx-accent-soft); border-radius: 999px;
  padding: 3px 6px 3px 3px; }
.rx-photochip img { width: 20px; height: 26px; object-fit: cover; border-radius: 4px; display: block; }
.rx-photochip button { border: none; background: none; cursor: pointer; color: inherit;
  font-size: 15px; line-height: 1; padding: 0 2px; font-family: inherit; }
.rx-dropping { outline: 2px dashed var(--rx-accent); outline-offset: -6px; }

.rx-doc { flex: 1 1 auto; overflow-y: auto; padding: 26px 30px; min-height: 0;
  font-family: Georgia, "Songti SC", "SimSun", serif; font-size: 13.5px; line-height: 1.75; color: #22221f; }
.rx-doc h1 { font-size: 21px; margin: 0 0 4px; font-weight: 600; letter-spacing: .5px; }
.rx-doc h2 { font-size: 13px; margin: 20px 0 7px; padding-left: 8px; font-weight: 600;
  border-left: 3px solid var(--rx-ink); letter-spacing: .5px; font-family: "Microsoft YaHei", sans-serif; }
.rx-doc h3 { font-size: 13px; margin: 14px 0 5px; font-weight: 600; }
.rx-doc p { margin: 5px 0; }
.rx-doc ul { margin: 5px 0; padding-left: 18px; }
.rx-doc li { margin: 2px 0; }
.rx-doc strong { font-weight: 600; }
.rx-doc .em { font-style: normal; color: #9a6a1a; }
.rx-doc .placeholder { color: #b0aea6; }

.rx-empty { color: var(--rx-ink-3); text-align: center; padding: 60px 20px; font-family: "Microsoft YaHei", sans-serif; }

.rx-stylebar { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  padding: 9px 18px; border-bottom: 1px solid var(--rx-line); background: #fcfcfa;
  font-size: 12px; color: var(--rx-ink-2); }
.rx-stylebar label { display: inline-flex; align-items: center; gap: 6px; }
.rx-stylebar select { font-family: inherit; font-size: 12px; padding: 3px 6px; border-radius: 6px;
  border: 1px solid var(--rx-line-strong); background: #fff; color: var(--rx-ink); cursor: pointer; }
.rx-stylebar select:disabled { opacity: .5; cursor: not-allowed; }
.rx-fit { margin-left: auto; }
.rx-fit input { accent-color: var(--rx-accent); cursor: pointer; }
/* 按 JD 定制面板 */
.rx-jd { flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;
  padding: 12px 18px; border-bottom: 1px solid var(--rx-line); background: #f7f9f8; }
.rx-jd textarea { font-family: inherit; font-size: 12.5px; line-height: 1.5; resize: vertical;
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--rx-line-strong);
  background: #fff; color: var(--rx-ink); }
.rx-jd textarea:focus { outline: 2px solid var(--rx-accent-soft, #cfe8de); outline-offset: 0; }
.rx-jd-foot { display: flex; align-items: center; gap: 10px; }
.rx-jd-warn { flex: 1; font-size: 11.5px; color: var(--rx-ink-3, #8a8a8a); }
.rx-doc iframe { width: 100%; height: 100%; min-height: 420px; border: 0; display: block; background: #fff; }
.rx-photo-bar { display: none; align-items: center; gap: 10px; padding: 10px 18px; border-top: 1px solid var(--rx-line);
  background: var(--rx-accent-soft); font-size: 12px; color: var(--rx-ink-2); }
.rx-photo-bar.on { display: flex; }
.rx-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(0,0,0,.18);
  border-top-color: var(--rx-accent); border-radius: 50%; animation: rx-spin .7s linear infinite; vertical-align: -2px; margin-right: 6px; }
@keyframes rx-spin { to { transform: rotate(360deg); } }

@media (max-width: 940px) {
  .rx { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; height: auto; }
  .rx-col--chat { border-right: none; border-bottom: 1px solid var(--rx-line); }
  .rx-msgs { max-height: 380px; }
  .rx-doc { max-height: 520px; }
}
`;
const EXAMPLES = [
    "帮我做一份简历",
    "我学过 Java 和 Python，想做后端开发",
    "我有段实习经历，但不知道怎么写进简历",
];
function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID))
        return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
}
function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function mount(el, deps) {
    ensureStyle(el.ownerDocument);
    el.innerHTML = `
  <div class="rx">
    <div class="rx-col rx-col--chat">
      <div class="rx-head">
        <div class="rx-brand">简历专家<small>引导式简历生成</small></div>
        <div class="rx-progress">
          <span class="lbl">完整度</span>
          <span class="rx-bar"><i></i></span>
          <span class="rx-pct">0%</span>
        </div>
      </div>
      <div class="rx-msgs"></div>
      <div class="rx-chips"></div>
      <div class="rx-missing" hidden></div>
      <div class="rx-photo-bar">
        <span>要加一张证件照吗？加上会让简历更完整。</span>
        <button class="rx-btn" data-act="pick-photo">选择照片</button>
        <button class="rx-btn" data-act="export-nophoto">不用照片，直接生成</button>
        <button class="rx-btn" data-act="cancel-photo" style="border:none;background:none;color:#8b8a83">取消</button>
      </div>
      <form class="rx-form">
        <textarea placeholder="用你自己的话说就行，不用讲究格式。想到什么说什么。"></textarea>
        <div class="row">
          <button class="rx-btn rx-btn--primary" type="submit">发送</button>
          <button class="rx-btn" type="button" data-act="add-photo"
                  title="也可以直接 Ctrl+V 粘贴，或把图片拖进来">贴证件照</button>
          <span class="rx-photochip" hidden></span>
          <span class="rx-hint"></span>
        </div>
      </form>
    </div>

    <div class="rx-col rx-col--preview">
      <div class="rx-head">
        <div class="rx-brand">简历预览<small>实时更新</small></div>
        <div class="rx-progress">
          <button class="rx-btn" data-act="compose" disabled>生成定稿</button>
          <button class="rx-btn" data-act="revise" disabled>继续修改</button>
          <button class="rx-btn" data-act="tailor" disabled title="粘贴目标岗位的招聘 JD，按它重写这一版">按 JD 定制</button>
          <button class="rx-btn rx-btn--primary" data-act="export" disabled>下载 PDF</button>
        </div>
      </div>
      <div class="rx-stylebar">
        <label title="决定哪个板块排在前面。技术岗把技能提前；项目比实习更拿得出手就选「项目优先」">版式
          <select data-style="archetype">
            <option value="standard">通用</option>
            <option value="skill-first">技术岗</option>
            <option value="project-first">项目优先</option>
          </select>
        </label>
        <label>字体
          <select data-style="font">
            <option value="sans">黑体</option>
            <option value="serif">宋体</option>
          </select>
        </label>
        <label>密度
          <select data-style="density">
            <option value="loose">宽松</option>
            <option value="normal" selected>标准</option>
            <option value="compact">紧凑</option>
          </select>
        </label>
        <label>照片
          <select data-style="photoShape">
            <option value="square">方形</option>
            <option value="round">圆角</option>
          </select>
        </label>
        <label class="rx-fit"><input type="checkbox" data-style="fit" checked /> 尽量压到一页</label>
      </div>
      <!-- 按 JD 定制：定稿后才会展开。放在排版栏下面，避免它一出现就把上面的按钮挤走 -->
      <div class="rx-jd" hidden>
        <textarea data-jd rows="4" placeholder="把目标岗位的招聘 JD 整段粘进来（岗位职责 + 任职要求），我会按它重写这一版。"></textarea>
        <div class="rx-jd-foot">
          <!-- 这句提示是必须的：定制会覆盖当前稿，用户得先知道 -->
          <span class="rx-jd-warn">定制后会替换当前版本，想留底可以先下载一份。</span>
          <button class="rx-btn" type="button" data-act="jd-cancel">取消</button>
          <button class="rx-btn rx-btn--primary" type="button" data-act="jd-run">开始定制</button>
        </div>
      </div>
      <div class="rx-doc"><div class="rx-empty">还没有内容。<br />在左边告诉我想做什么，我就会开始整理。</div></div>
    </div>
    <input type="file" accept="image/png,image/jpeg,image/webp" hidden />
  </div>`;
    const root = el.firstElementChild;
    /**
     * 取必需节点：找不到就抛出带选择器的明确错误。
     *
     * 不用 `querySelector(...)!` —— TypeScript 的非空断言在运行时会被擦除，
     * 一旦选择器写错（或者节点被放到容器外），报错会是
     * "Cannot read properties of null (reading 'addEventListener')"，
     * 完全看不出是哪个选择器出的问题。这个 helper 就是踩过这个坑之后加的。
     */
    const must = (sel) => {
        const node = root.querySelector(sel);
        if (!node)
            throw new Error(`[resume-expert] 缺少必需的 DOM 节点：${sel}`);
        return node;
    };
    const $ = must;
    const msgsEl = $(".rx-msgs");
    const chipsEl = $(".rx-chips");
    const missingEl = $(".rx-missing");
    const docEl = $(".rx-doc");
    const formEl = $(".rx-form");
    const textareaEl = $(".rx-form textarea");
    const hintEl = $(".rx-hint");
    const barEl = $(".rx-bar i");
    const pctEl = $(".rx-pct");
    const photoBarEl = $(".rx-photo-bar");
    const fileEl = $('input[type="file"]');
    const composeBtn = $('[data-act="compose"]');
    const exportBtn = $('[data-act="export"]');
    const sendBtn = $('.rx-form button[type="submit"]');
    const pickPhotoBtn = $('[data-act="pick-photo"]');
    const exportNoPhotoBtn = $('[data-act="export-nophoto"]');
    const cancelPhotoBtn = $('[data-act="cancel-photo"]');
    const archeSel = $('[data-style="archetype"]');
    const fontSel = $('[data-style="font"]');
    const densitySel = $('[data-style="density"]');
    const shapeSel = $('[data-style="photoShape"]');
    const fitEl = $('[data-style="fit"]');
    const addPhotoBtn = $('[data-act="add-photo"]');
    const reviseBtn = $('[data-act="revise"]');
    const tailorBtn = $('[data-act="tailor"]');
    const jdPanel = $(".rx-jd");
    const jdInput = $("[data-jd]");
    const jdRunBtn = $('[data-act="jd-run"]');
    const jdCancelBtn = $('[data-act="jd-cancel"]');
    const photoChipEl = $(".rx-photochip");
    let sessionId = "";
    let busy = false;
    let current = null;
    /** draft = 显示文字稿（能看到「待补充」缺口）；real = 显示真实版式预览 */
    let previewMode = "draft";
    /** 当前生效的证件照（data URL） */
    let currentPhoto;
    /** 会话还没建立时先暂存的照片：用户可能一进来就先贴图 */
    let pendingPhoto = null;
    /** 本地也校验一遍再用——它会被拼进 innerHTML，不能信任意字符串 */
    const PHOTO_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
    const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
    const styleState = () => ({
        archetype: archeSel.value,
        font: fontSel.value,
        density: densitySel.value,
        photoShape: shapeSel.value,
    });
    function setBusy(on, note = "") {
        busy = on;
        updateSendState();
        composeBtn.disabled = on || !sessionId;
        exportBtn.disabled = on || !sessionId;
        reviseBtn.disabled = on || !isComposed();
        // 和「继续修改」同一条件：对一份没定稿的草稿做 JD 定制没有意义
        tailorBtn.disabled = on || !isComposed();
        jdRunBtn.disabled = on;
        hintEl.innerHTML = on ? `<span class="rx-spin"></span>${escapeHtml(note)}` : "";
    }
    /**
     * 输入框为空时禁用「发送」。
     *
     * 之前这里只跟着 busy 走，于是空输入框上挂着一个能点但点了没反应的按钮。
     * 贴完证件照的用户最容易撞上它——他们会以为"要点发送才能把照片交上去"，
     * 点下去却毫无反应，然后就不知道该怎么办了。
     * 一个看起来能点却没反应的按钮，比一个明确灰掉的按钮糟糕得多。
     */
    function updateSendState() {
        const hasText = textareaEl.value.trim().length > 0;
        sendBtn.disabled = busy || !hasText;
        if (hasText && !busy)
            hintEl.textContent = "";
    }
    /** 「继续修改」只在定稿之后才有意义 */
    function isComposed() {
        return current?.stage === "compose" || current?.stage === "export";
    }
    function pushMsg(role, text) {
        const div = el.ownerDocument.createElement("div");
        div.className = `rx-msg rx-msg--${role}`;
        const who = role === "user" ? "你" : role === "err" ? "出错了" : "简历专家";
        div.innerHTML = `<div class="who">${who}</div><div class="body">${escapeHtml(text)}</div>`;
        msgsEl.appendChild(div);
        msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    function renderChips() {
        if (chipsEl.dataset.done === "1")
            return;
        chipsEl.innerHTML = EXAMPLES.map((t) => `<button class="rx-chip" type="button">${escapeHtml(t)}</button>`).join("");
        chipsEl.querySelectorAll(".rx-chip").forEach((btn) => {
            btn.addEventListener("click", () => {
                chipsEl.dataset.done = "1";
                chipsEl.innerHTML = "";
                void send(btn.textContent ?? "");
            });
        });
    }
    function renderDoc(markdown) {
        if (!markdown.trim())
            return;
        docEl.innerHTML = mdToHtml(markdown).replace(/（待补充）/g, '<span class="placeholder">（待补充）</span>');
    }
    function renderDraft(draft) {
        current = draft;
        sessionId = draft.sessionId;
        pctEl.textContent = `${draft.completeness}%`;
        barEl.style.width = `${draft.completeness}%`;
        if (previewMode === "real")
            void showRealPreview();
        else
            renderDoc(draft.markdown);
        if (draft.missing.length > 0) {
            missingEl.hidden = false;
            missingEl.innerHTML = `<h4>还缺这些信息（补得越多，简历越有竞争力）</h4><ul>${draft.missing
                .map((m) => `<li><span class="tag">${m.priority === "high" ? "重要" : m.priority === "medium" ? "建议" : "可选"}</span><span class="q">${escapeHtml(m.label)}</span><div class="why">${escapeHtml(m.why)}</div></li>`)
                .join("")}</ul>`;
        }
        else {
            missingEl.hidden = true;
            missingEl.innerHTML = "";
        }
        composeBtn.disabled = busy;
        exportBtn.disabled = busy;
        reviseBtn.disabled = busy || !isComposed();
        tailorBtn.disabled = busy || !isComposed();
    }
    async function send(text) {
        const content = text.trim();
        if (!content || busy)
            return;
        pushMsg("user", content);
        textareaEl.value = "";
        updateSendState();
        setBusy(true, "正在整理…");
        try {
            if (!sessionId) {
                const draft = await deps.plugin.capability("intake").run({ raw: content }, deps.ctx);
                renderDraft(draft);
                pushMsg("agent", draft.reply);
                if (draft.nextQuestion)
                    pushMsg("agent", `👉 ${draft.nextQuestion}`);
                // 用户可能一进来就先贴了照片，那时还没有会话——现在补交
                if (pendingPhoto) {
                    const photo = pendingPhoto;
                    pendingPhoto = null;
                    await applyPhoto(photo);
                }
            }
            else {
                const draft = await deps.plugin
                    .capability("refine")
                    .run({ sessionId, answer: content }, deps.ctx);
                renderDraft(draft);
                pushMsg("agent", draft.reply);
                if (draft.nextQuestion)
                    pushMsg("agent", `👉 ${draft.nextQuestion}`);
            }
            deps.host.telemetry.event("resume.widget.turn", {
                completeness: current?.completeness ?? 0,
            });
        }
        catch (e) {
            const err = e;
            pushMsg("err", err?.message ?? "调用失败，请重试");
            deps.host.telemetry.error("resume.widget.error", e, { stage: sessionId ? "refine" : "intake" });
        }
        finally {
            setBusy(false);
        }
    }
    async function compose() {
        if (!sessionId || busy)
            return;
        setBusy(true, "正在成稿…");
        try {
            const draft = await deps.plugin
                .capability("compose")
                .run({ sessionId }, deps.ctx);
            renderDraft(draft);
            pushMsg("agent", draft.reply);
            if (currentPhoto) {
                pushMsg("agent", "照片已经贴好了，随时可以下载 PDF。");
            }
            else {
                pushMsg("agent", "要加一张证件照吗？加上会让简历更完整。也可以选择不用照片直接生成。");
                photoBarEl.classList.add("on");
            }
            // 成稿后预览切成「真实版式」，用户第一次看到简历最终长什么样
            previewMode = "real";
            await showRealPreview();
        }
        catch (e) {
            const err = e;
            pushMsg("err", err?.message ?? "成稿失败，请重试");
        }
        finally {
            setBusy(false);
        }
    }
    /** 读取图片文件，先做本地体检再交给回调 */
    function readImageFile(file, onOk) {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
            pushMsg("err", "证件照只支持 png / jpg / webp 格式。");
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            pushMsg("err", "照片请控制在 3MB 以内——太大会拖慢生成，也没必要。");
            return;
        }
        const reader = new FileReader();
        reader.onload = () => onOk(String(reader.result ?? ""));
        reader.onerror = () => pushMsg("err", "照片读取失败，请重试。");
        reader.readAsDataURL(file);
    }
    function renderPhotoChip() {
        if (!currentPhoto) {
            photoChipEl.hidden = true;
            photoChipEl.innerHTML = "";
            return;
        }
        photoChipEl.hidden = false;
        // currentPhoto 已通过 PHOTO_RE 校验，只含 base64 字符，拼进 innerHTML 是安全的
        photoChipEl.innerHTML =
            `<img src="${currentPhoto}" alt="证件照" />` +
                `<span>证件照 · 已保存</span>` +
                `<button type="button" title="移除照片">×</button>`;
        photoChipEl.querySelector("button")?.addEventListener("click", () => void clearPhoto());
    }
    /**
     * 应用照片。
     *
     * 两条分支刻意都留着：
     *  - 已有会话 → 立刻落库（set-photo）并刷新预览，用户马上看到照片在简历里
     *  - 尚未建会话 → 先存本地，等 intake 拿到 sessionId 再自动补交。
     *    这样"一进来就先贴图"和"聊到一半再贴图"两种顺序都能用，用户感知不到差别。
     */
    async function applyPhoto(dataUrl) {
        if (!PHOTO_RE.test(dataUrl)) {
            pushMsg("err", "这张图片的格式无法识别，换一张试试。");
            return;
        }
        currentPhoto = dataUrl;
        renderPhotoChip();
        if (!sessionId) {
            pendingPhoto = dataUrl;
            hintEl.textContent = "照片已存好，不用发送";
            pushMsg("agent", "收到，照片已存好——不用再点发送。等我们开始整理简历，它会自动贴到右上角。");
            return;
        }
        try {
            await deps.plugin
                .capability("set-photo")
                .run({ sessionId, photo: dataUrl }, deps.ctx);
            hintEl.textContent = "照片已存好，不用发送";
            // 只有成稿之后预览才是真实版式，才看得到照片。
            // 草稿阶段右侧是文字稿——这时候说"右边能看到效果"就是在骗人，
            // 用户会盯着一个没有照片的预览发呆。所以按阶段说实话，并告诉他下一步做什么。
            if (previewMode === "real") {
                await showRealPreview();
                pushMsg("agent", "照片已贴到简历右上角，右边可以看到效果。");
            }
            else {
                pushMsg("agent", "照片已存好了，不用再点发送。现在右边显示的是文字稿，" +
                    "等你点「生成定稿」，照片会自动贴到简历右上角。");
            }
        }
        catch (e) {
            const err = e;
            pushMsg("err", err?.message ?? "照片保存失败，请重试。");
            currentPhoto = undefined;
            renderPhotoChip();
        }
    }
    async function clearPhoto() {
        currentPhoto = undefined;
        pendingPhoto = null;
        renderPhotoChip();
        if (!sessionId)
            return;
        try {
            await deps.plugin
                .capability("set-photo")
                .run({ sessionId, photo: "" }, deps.ctx);
            if (previewMode === "real")
                await showRealPreview();
        }
        catch {
            /* 移除失败不影响主流程，下次导出时仍可覆盖 */
        }
    }
    /**
     * 真实版式预览。
     *
     * 用 iframe + srcdoc 而不是直接 innerHTML：简历 HTML 自带 <style> 与 @page 规则，
     * 注进主文档会污染整个界面（@page 甚至会影响浏览器打印本页）。
     * 用 sandbox 隔离后，它既不会影响宿主样式，也拿不到宿主的 DOM。
     */
    async function showRealPreview() {
        if (!sessionId)
            return;
        previewMode = "real";
        try {
            const out = await deps.plugin
                .capability("export")
                .run({ sessionId, format: "html", style: styleState() }, deps.ctx);
            docEl.innerHTML = `<iframe sandbox="" title="简历版式预览"></iframe>`;
            const frame = docEl.querySelector("iframe");
            if (frame)
                frame.srcdoc = out.html;
        }
        catch (e) {
            const err = e;
            pushMsg("err", err?.message ?? "预览失败");
        }
    }
    /** 把 base64 PDF 变成真正的文件下载 */
    function downloadPdf(base64, filename) {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        const a = el.ownerDocument.createElement("a");
        a.href = url;
        a.download = filename;
        el.ownerDocument.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    async function doExport(photo) {
        if (!sessionId || busy)
            return;
        photoBarEl.classList.remove("on");
        setBusy(true, "正在排版…");
        try {
            const input = {
                sessionId,
                format: "pdf",
                style: styleState(),
                fitSinglePage: fitEl.checked,
            };
            if (photo)
                input.photo = photo;
            const out = await deps.plugin
                .capability("export")
                .run(input, deps.ctx);
            // 回显实际生效的样式——「压到一页」可能已自动收紧了密度
            if (out.style) {
                archeSel.value = out.style.archetype;
                fontSel.value = out.style.font;
                densitySel.value = out.style.density;
                shapeSel.value = out.style.photoShape;
            }
            if (out.pdf) {
                downloadPdf(out.pdf.base64, "简历.pdf");
                const note = out.pdf.pages <= 1
                    ? "已压到 1 页。"
                    : fitEl.checked
                        ? `共 ${out.pdf.pages} 页——内容偏多，即使最紧凑的版式也放不进 1 页，建议精简描述。`
                        : `共 ${out.pdf.pages} 页。`;
                pushMsg("agent", `简历已生成，文件已开始下载。${note}`);
            }
            else {
                // 宿主没有提供渲染能力 → 降级为「打开打印窗口，另存为 PDF」
                const win = el.ownerDocument.defaultView?.open("", "_blank");
                if (!win) {
                    pushMsg("err", "浏览器拦截了新窗口，请允许弹窗后重试。");
                    return;
                }
                win.document.open();
                win.document.write(out.html);
                win.document.close();
                win.setTimeout(() => {
                    win.focus();
                    win.print();
                }, 500);
                pushMsg("agent", `${out.pdfUnavailableReason ?? "已生成可打印页面"}。在新窗口里选择「另存为 PDF」即可保存。`);
            }
            await showRealPreview();
            deps.host.telemetry.event("resume.widget.export", {
                hasPhoto: out.hasPhoto,
                format: out.format,
            });
        }
        catch (e) {
            const err = e;
            pushMsg("err", err?.message ?? "生成 PDF 失败，请重试");
        }
        finally {
            setBusy(false);
        }
    }
    const onCompose = () => void compose();
    // 证件照已经存在会话里（set-photo 落过库），导出时不必再传一遍
    const onExport = () => void doExport();
    const onPickPhoto = () => fileEl.click();
    const onExportNoPhoto = () => void doExport();
    const onCancelPhoto = () => photoBarEl.classList.remove("on");
    const onFile = () => {
        const file = fileEl.files?.[0];
        if (!file)
            return;
        readImageFile(file, (dataUrl) => void applyPhoto(dataUrl));
        // 清空 value，否则用户移除照片后再选同一张不会触发 change
        fileEl.value = "";
    };
    // —— 贴图三通道：粘贴 / 拖拽 / 选文件 ——
    // 三条都走同一个 applyPhoto，行为完全一致。
    const onAddPhoto = () => fileEl.click();
    const onPaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items)
            return;
        for (const item of items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) {
                    e.preventDefault(); // 别让图片在输入框里变成一串乱码
                    readImageFile(file, (dataUrl) => void applyPhoto(dataUrl));
                    return;
                }
            }
        }
    };
    const onDragOver = (e) => {
        const types = e.dataTransfer?.types;
        if (types && Array.from(types).includes("Files")) {
            e.preventDefault();
            root.classList.add("rx-dropping");
        }
    };
    const onDragLeave = () => root.classList.remove("rx-dropping");
    const onDrop = (e) => {
        root.classList.remove("rx-dropping");
        const file = e.dataTransfer?.files?.[0];
        if (!file)
            return;
        e.preventDefault();
        if (file.type.startsWith("image/")) {
            readImageFile(file, (dataUrl) => void applyPhoto(dataUrl));
        }
        else {
            pushMsg("err", "只能拖入图片文件。");
        }
    };
    const onRevise = () => {
        textareaEl.focus();
        pushMsg("agent", "想改哪里直接说——补充一段经历、调个措辞，或者指出哪句你觉得写得不好，我来改。");
    };
    // —— 按 JD 定制 ——
    // 这一条路和别的不同：它不经过对话，而是把 JD 直接喂给 tailor 能力。
    // 所以界面上要自己负责"输入 → 触发 → 反馈"这一小段闭环。
    const onTailorOpen = () => {
        jdPanel.hidden = false;
        jdInput.focus();
    };
    const onJdCancel = () => {
        jdPanel.hidden = true;
        jdInput.value = "";
    };
    const onJdRun = async () => {
        if (busy || !sessionId)
            return;
        const jd = jdInput.value.trim();
        // 太短的输入大概率不是 JD（比如只粘了岗位名），与其让它瞎改不如当场说清
        if (jd.length < 30) {
            pushMsg("err", "这段太短了，判断不出岗位要什么。把「岗位职责 + 任职要求」整段粘进来再试。");
            jdInput.focus();
            return;
        }
        setBusy(true, "正在按这个 JD 重写…");
        try {
            const out = await deps.plugin
                .capability("tailor")
                .run({ sessionId, jd }, deps.ctx);
            if (out.offTopic) {
                pushMsg("err", out.reply ?? "这段内容看着不像岗位 JD，我没法按它改。");
                return;
            }
            jdPanel.hidden = true;
            jdInput.value = "";
            pushMsg("agent", out.reply ?? "已按这份 JD 重写了一版，右边可以预览和下载。");
            // tailor 已把结果写回会话，这里只需重新拉一次渲染——预览和 PDF 都跟着变
            await showRealPreview();
        }
        catch (e) {
            const err = e;
            pushMsg("err", err?.message ?? "定制失败，请重试。");
        }
        finally {
            setBusy(false);
        }
    };
    const onSubmit = (e) => {
        e.preventDefault();
        void send(textareaEl.value);
    };
    composeBtn.addEventListener("click", onCompose);
    exportBtn.addEventListener("click", onExport);
    reviseBtn.addEventListener("click", onRevise);
    tailorBtn.addEventListener("click", onTailorOpen);
    jdRunBtn.addEventListener("click", onJdRun);
    jdCancelBtn.addEventListener("click", onJdCancel);
    addPhotoBtn.addEventListener("click", onAddPhoto);
    formEl.addEventListener("submit", onSubmit);
    fileEl.addEventListener("change", onFile);
    pickPhotoBtn.addEventListener("click", onPickPhoto);
    exportNoPhotoBtn.addEventListener("click", onExportNoPhoto);
    cancelPhotoBtn.addEventListener("click", onCancelPhoto);
    root.addEventListener("paste", onPaste);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("dragleave", onDragLeave);
    root.addEventListener("drop", onDrop);
    textareaEl.addEventListener("input", updateSendState);
    // 初始就是空输入框，发送按钮该是灰的
    updateSendState();
    // 改排版即时反映到预览上——不然用户只能靠"下载一次看看"来试样式
    const onStyleChange = () => {
        if (sessionId)
            void showRealPreview();
    };
    archeSel.addEventListener("change", onStyleChange);
    fontSel.addEventListener("change", onStyleChange);
    densitySel.addEventListener("change", onStyleChange);
    shapeSel.addEventListener("change", onStyleChange);
    fitEl.addEventListener("change", onStyleChange);
    pushMsg("agent", "你好，我是简历专家。\n你不需要懂简历该怎么写，也不用讲究格式——把事情讲给我听就行，我来整理。\n先说说：你想找个什么样的工作？或者你学过什么、做过什么？");
    renderChips();
    return () => {
        composeBtn.removeEventListener("click", onCompose);
        exportBtn.removeEventListener("click", onExport);
        reviseBtn.removeEventListener("click", onRevise);
        tailorBtn.removeEventListener("click", onTailorOpen);
        jdRunBtn.removeEventListener("click", onJdRun);
        jdCancelBtn.removeEventListener("click", onJdCancel);
        addPhotoBtn.removeEventListener("click", onAddPhoto);
        formEl.removeEventListener("submit", onSubmit);
        fileEl.removeEventListener("change", onFile);
        root.removeEventListener("paste", onPaste);
        root.removeEventListener("dragover", onDragOver);
        root.removeEventListener("dragleave", onDragLeave);
        root.removeEventListener("drop", onDrop);
        textareaEl.removeEventListener("input", updateSendState);
        el.innerHTML = "";
    };
}
export default { mount };
