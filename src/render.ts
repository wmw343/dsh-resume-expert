/**
 * 宿主侧的 PDF 渲染实现（Demo 宿主）。
 *
 * 思路：复用本机已有的 Chrome / Edge 的 headless 模式，通过 CDP 的
 * `Page.printToPDF` 直出 PDF。**不装 puppeteer、不装 playwright、不下载 Chromium**，
 * 与 browser-check.mjs 用的是同一套零依赖手法。
 *
 * 为什么值得这么做：
 *  - 真 PDF 字节：可以做真正的「下载文件」，而不是让用户自己「另存为」
 *  - 能同时返回**页数**：这是「压缩到一页」自适应排版的前提
 *  - 中文排版、分页、字体全部交给浏览器引擎，比自己手写 PDF 靠谱得多
 *
 * 接入方要替换成自己的云端渲染服务时，只需实现同一个 RenderService 接口。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { PdfResult, RenderService } from "./plugin/src/contract/host.ts";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Users/lenovo/AppData/Local/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Users/lenovo/AppData/Local/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findBrowser(): string | null {
  return BROWSERS.find((p) => existsSync(p)) ?? null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 等 Chrome 在 stderr 里报出它真正监听的调试端口。
 *
 * 不要自己先挑一个端口再传给 Chrome —— 那是 TOCTOU 竞态：
 * 你探测到空闲、到 Chrome 去 bind 之间，端口可能已被别的进程占走，
 * 于是 Chrome 悄悄换了一个端口，你还在傻等原来那个。
 * 传 `--remote-debugging-port=0` 让 Chrome 自己挑，再从它的输出里读回来，才是可靠做法。
 */
function waitForDevToolsPort(stderrRef: () => string, timeoutMs = 20000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const m = stderrRef().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) return resolve(Number(m[1]));
      if (Date.now() > deadline) {
        const tail = stderrRef().trim().split(/\r?\n/).slice(-3).join(" | ");
        return reject(new Error(`无头浏览器启动超时${tail ? `：${tail}` : ""}`));
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

async function waitForPageTarget(port: number, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  throw new Error("找不到可用的页面目标（page target）");
}

/** 极简 CDP 客户端：够用就好，不引 SDK */
function makeCdp(ws: WebSocket) {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  ws.addEventListener("message", (ev) => {
    let msg: { id?: number; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });

  return (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
}

/** 从 PDF 字节里数页数；Chrome 的输出通常是未压缩的，能直接数出来 */
function countPdfPages(buf: Buffer): number | null {
  const text = buf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  if (!matches || matches.length === 0) return null;
  return matches.length;
}

async function renderOnce(html: string, browserPath: string): Promise<PdfResult> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "rxpdf-"));
  const htmlPath = path.join(userDataDir, "resume.html");
  writeFileSync(htmlPath, html, "utf8");

  let child: ChildProcess | null = null;
  let ws: WebSocket | null = null;
  let chromeStderr = "";

  try {
    child = spawn(
      browserPath,
      [
        "--headless=new",
        // 让 Chrome 自己挑调试端口，避免 TOCTOU 竞态
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        // 注意：这里**不把目标页面作为启动参数传进去**。
        // 实测（Chrome 152 / Windows）以 `file:///...` 作为启动参数时，
        // Chrome 根本不创建 page target，/json/list 里只有组件扩展的后台页，
        // 表现为"找不到可用页面目标"。改为先开 about:blank，
        // 拿到 page target 之后再由 CDP 导航，时机完全可控。
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );

    child.stderr?.on("data", (d) => {
      chromeStderr += String(d);
    });
    child.on("error", (e) => {
      chromeStderr += `spawn error: ${e.message}`;
    });

    const port = await waitForDevToolsPort(() => chromeStderr);
    const wsUrl = await waitForPageTarget(port);
    ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws!.addEventListener("open", () => resolve(), { once: true });
      ws!.addEventListener("error", () => reject(new Error("CDP 连接失败")), { once: true });
    });

    const send = makeCdp(ws);
    await send("Page.enable");
    await send("Runtime.enable");

    // 自己导航过去。file:// 比 data: URL 稳，且不受 URL 长度限制
    await send("Page.navigate", { url: `file:///${htmlPath.replace(/\\/g, "/")}` });

    // 等页面就绪
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const r = await send("Runtime.evaluate", {
        expression: 'document.readyState === "complete" && !!document.querySelector(".sheet")',
        returnByValue: true,
      });
      if (r.result?.value === true) break;
      await sleep(100);
    }

    const pdf = await send("Page.printToPDF", {
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    const buf = Buffer.from(pdf.data as string, "base64");
    const byRegex = countPdfPages(buf);

    // DOM 估算作为兜底：@page 上下边距共 28mm
    let pages = byRegex;
    if (!pages) {
      await send("Emulation.setEmulatedMedia", { media: "print" });
      const m = await send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(".sheet") || document.body;
          const pxPerMm = 96 / 25.4;
          const pageH = (297 - 28) * pxPerMm;
          return Math.max(1, Math.ceil((el.scrollHeight - 4) / pageH));
        })()`,
        returnByValue: true,
      });
      pages = Number(m.result?.value) || 1;
    }

    return { base64: buf.toString("base64"), pages };
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
    await sleep(300);
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * 创建渲染服务。找不到浏览器时返回 null ——
 * 这样宿主干脆不提供 render，插件会自动降级成「返回 HTML」，
 * 而不是让用户在点「下载 PDF」时才撞上错误。
 */
export function createRenderService(): RenderService | null {
  const browserPath = findBrowser();
  if (!browserPath) return null;

  return {
    async pdf(html: string): Promise<PdfResult> {
      return renderOnce(html, browserPath);
    },
  };
}

/** 供宿主启动时打印提示 */
export function describeRenderer(): string {
  const b = findBrowser();
  if (!b) return "未找到 Chrome / Edge，PDF 直出不可用（将降级为 HTML 打印）";
  return path.basename(b);
}
