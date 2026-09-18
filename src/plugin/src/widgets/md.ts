/**
 * 极简 Markdown → HTML，零依赖。
 *
 * 只支持简历场景真正会用到的语法：# / ## / **粗体** / - 列表 / 段落。
 * 刻意不做通用 Markdown：语法面越小，越不容易被畸形输入弄出 XSS。
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/「(.+?)」/g, '<em class="em">$1</em>');
}

export function mdToHtml(markdown: string): string {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const out: string[] = [];
  let listBuf: string[] = [];
  let paraBuf: string[] = [];

  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(`<ul>${listBuf.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
    listBuf = [];
  };
  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push(`<p>${paraBuf.map(inline).join("<br />")}</p>`);
    paraBuf = [];
  };
  const flushAll = () => {
    flushList();
    flushPara();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushAll();
      out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushAll();
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushAll();
      out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      listBuf.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    flushList();
    paraBuf.push(line);
  }
  flushAll();

  return out.join("");
}
