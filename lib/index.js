import { defineTool } from "@deepseek-ai/dsh-tools";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resumeExpertPlugin } from "./plugin/src/index.js";
import { buildHostServices, buildContext } from "./adapter.js";
export const name = "resume-expert";
export const inject = ["tools"]; // 必需：等工具注册表就绪
export function apply(ctx) {
    const host = buildHostServices();
    const instance = resumeExpertPlugin.create(host);
    const OUT_DIR = path.join(process.cwd(), "resume-out");
    mkdirSync(OUT_DIR, { recursive: true });
    const save = (name, content) => {
        const p = path.join(OUT_DIR, name);
        writeFileSync(p, content, "utf8");
        return p;
    };
    const missingOf = (r) => (r.missing ?? []).map((m) => m.label).join("、") || "无";
    ctx.tools.register(defineTool({
        name: "resume_intake",
        description: "简历专家·阶段一：用户说要做简历/改简历时首先调用。输入用户关于自己的原始描述，返回 sessionId、第一版文字稿与待补充清单。记住返回的 sessionId，后续工具都要用。",
        parameters: {
            raw: { type: "string", required: true, description: "用户关于简历需求的原始描述" },
        },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args, exec) {
            const r = (await instance
                .capability("intake")
                .run({ raw: args.raw }, buildContext(exec.signal)));
            return [
                `sessionId: ${r.sessionId}`,
                `完整度: ${r.completeness}%`,
                `待补充: ${missingOf(r)}`,
                `追问: ${r.nextQuestion}`,
                "--- 文字稿 ---",
                r.markdown ?? "",
            ].join("\n");
        },
    }));
    ctx.tools.register(defineTool({
        name: "resume_refine",
        description: "简历专家·阶段二：把用户补充的信息（姓名/教育/实习/项目/技能等）合并进指定会话。可多轮调用。",
        parameters: {
            sessionId: { type: "string", required: true },
            answer: { type: "string", required: true, description: "用户这一轮补充的内容原文" },
        },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args, exec) {
            const r = (await instance
                .capability("refine")
                .run({ sessionId: args.sessionId, answer: args.answer }, buildContext(exec.signal)));
            return [
                `完整度: ${r.completeness}%`,
                `待补充: ${missingOf(r)}`,
                `追问: ${r.nextQuestion}`,
                "--- 文字稿 ---",
                r.markdown ?? "",
            ].join("\n");
        },
    }));
    ctx.tools.register(defineTool({
        name: "resume_compose",
        description: "简历专家·阶段三：把会话整合成可直接投递的定稿（删除占位、只留有信息量的内容）。",
        parameters: { sessionId: { type: "string", required: true } },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args, exec) {
            const r = (await instance
                .capability("compose")
                .run({ sessionId: args.sessionId }, buildContext(exec.signal)));
            const file = save(`简历草稿-${args.sessionId}.md`, r.markdown ?? "");
            return `定稿完成，已存到 ${file}\n--- 定稿 ---\n${r.markdown ?? ""}`;
        },
    }));
    ctx.tools.register(defineTool({
        name: "resume_export",
        description: "简历专家·阶段四：把定稿渲染成 A4 排版并导出 PDF（本机无 Chrome 时导出可打印 HTML）。必须先 resume_compose。",
        parameters: {
            sessionId: { type: "string", required: true },
            fitSinglePage: { type: "boolean", description: "尽量压到一页（逐档收紧密度）" },
        },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args, exec) {
            const r = (await instance
                .capability("export")
                .run({ sessionId: args.sessionId, fitSinglePage: args.fitSinglePage === true }, buildContext(exec.signal)));
            const ex = r;
            if (ex.format === "pdf" && ex.pdf) {
                const p = path.join(OUT_DIR, `简历-${args.sessionId}.pdf`);
                writeFileSync(p, Buffer.from(ex.pdf.base64, "base64"));
                return `PDF 已生成（${ex.pdf.pages} 页）：${p}`;
            }
            const p = save(`简历-${args.sessionId}.html`, ex.html ?? "");
            return `本机未提供 PDF 渲染（${ex.pdfUnavailableReason ?? "无 render 服务"}），已导出可打印 HTML：${p}（浏览器打开后 Ctrl+P 另存为 PDF）`;
        },
    }));
    ctx.tools.register(defineTool({
        name: "resume_set_photo",
        description: "简历专家·证件照：把本机一张照片（png/jpg/webp，≤3MB）设为指定会话的证件照，导出时出现在右上角。",
        parameters: {
            sessionId: { type: "string", required: true },
            photoPath: { type: "string", required: true, description: "照片的本地绝对路径" },
        },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args, exec) {
            const ext = path.extname(args.photoPath).toLowerCase();
            const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
            const photo = `data:${mime};base64,${readFileSync(args.photoPath).toString("base64")}`;
            const r = (await instance
                .capability("set-photo")
                .run({ sessionId: args.sessionId, photo }, buildContext(exec.signal)));
            return r.hasPhoto ? "证件照已设置，导出时会出现在简历右上角。" : "证件照已移除。";
        },
    }));
    ctx.tools.register(defineTool({
        name: "resume_tailor",
        description: "简历专家·按 JD 定制：把指定会话的简历按目标岗位 JD 重写（会替换当前版本，导出前建议先 resume_export 留底）。",
        parameters: {
            sessionId: { type: "string", required: true },
            jd: { type: "string", required: true, description: "目标岗位的 JD 原文" },
        },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args, exec) {
            const r = (await instance
                .capability("tailor")
                .run({ sessionId: args.sessionId, jd: args.jd }, buildContext(exec.signal)));
            return `定制完成：${r.reply ?? "已按 JD 调整。"}`;
        },
    }));
    ctx.logger.info("[resume-expert] 6 个简历工具已注册");
}
