/**
 * 会话持久化自测（零依赖，不需要网络，不需要启动 dsh）。
 *
 * 覆盖 B1 验证时确认的每条不变量 —— 尤其「跨进程存活」：
 * 它是「重启 dsh web 后草稿还在」这个产品承诺的直接对应断言。
 *
 * 用法：node tests/store.test.mjs
 *   子进程模式（测试内部用）：
 *     node tests/store.test.mjs __write <file>
 *     node tests/store.test.mjs __read  <file>
 *     node tests/store.test.mjs __removeAndExit <file>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFileKv } from "../lib/store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

// —— 子进程模式：让「跨进程」这条断言真的跨进程 ——
const sub = process.argv[2];
if (sub?.startsWith("__")) {
  const file = process.argv[3];
  const kv = createFileKv(file, { debounceMs: 20 });
  if (sub === "__write") {
    await kv.set("k", { from: "child-A", n: 42 });
    kv.flush();
    console.log("child-A: written");
  } else if (sub === "__read") {
    const v = await kv.get("k");
    console.log("child-B: " + JSON.stringify(v));
  } else if (sub === "__removeAndExit") {
    await kv.remove("k");
    kv.flush();
    console.log("child-C: removed");
  } else if (sub === "__append") {
    // 模拟「第二轮的会话更新」：读出来、加一个字段、写回去
    const v = (await kv.get("k")) ?? {};
    await kv.set("k", { ...v, stage2: true });
    kv.flush();
    console.log("child-D: appended");
  }
  process.exit(0);
}

// —— 测试运行器 ——
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail === undefined ? "" : "  →  " + JSON.stringify(detail)}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = path.join(os.tmpdir(), `resume-store-test-${Date.now().toString(36)}`);
mkdirSync(ROOT, { recursive: true });
const P = (name) => path.join(ROOT, name);
const child = (mode, file) =>
  spawnSync(process.execPath, [SELF, mode, file], { encoding: "utf8", windowsHide: true });

console.log("\n会话持久化自测（store.ts）\n");

// [1] 同路径复用同一实例 —— 防「重复 apply 导致旧快照覆盖新数据」
{
  const f = P("same.json");
  const a = createFileKv(f, { debounceMs: 20 });
  const b = createFileKv(f, { debounceMs: 20 });
  check("同一路径返回同一实例（防旧快照覆盖新数据）", a === b);
  check("不同路径返回不同实例", createFileKv(P("other.json")) !== a);
}

// [2] 基本读写 + 删除
{
  const f = P("crud.json");
  const kv = createFileKv(f, { debounceMs: 20 });
  await kv.set("x", { v: 1 });
  check("set 后 get 能取回", (await kv.get("x"))?.v === 1);
  check("get 不存在的键返回 null", (await kv.get("nope")) === null);
  await kv.remove("nope");
  check("remove 不存在的键不报错", true);
  await kv.remove("x");
  check("remove 后 get 返回 null", (await kv.get("x")) === null);
}

// [3] TTL 过期
{
  const f = P("ttl.json");
  const kv = createFileKv(f, { debounceMs: 20 });
  await kv.set("short", { v: 1 }, 80);
  await kv.set("forever", { v: 2 });
  check("TTL 未到时能取回", (await kv.get("short"))?.v === 1);
  await sleep(160);
  check("TTL 到后返回 null", (await kv.get("short")) === null);
  check("无 TTL 的键永不过期", (await kv.get("forever"))?.v === 2);
}

// [4] 跨进程存活 —— 对应「重启 dsh web 后草稿还在」
{
  const f = P("cross.json");
  const w = child("__write", f);
  check("子进程 A 写入成功", /written/.test(w.stdout), w.stdout + w.stderr);
  check("写入后文件已存在", existsSync(f));
  const r = child("__read", f);
  check("子进程 B（模拟重启）读到 A 的数据", /child-A/.test(r.stdout), r.stdout + r.stderr);
  const a = child("__append", f);
  check("子进程 D 能接着改（多轮会话更新的形态）", /appended/.test(a.stdout), a.stdout + a.stderr);
  const r2 = child("__read", f);
  check("改动对后续进程可见（stage2=true）", /stage2/.test(r2.stdout), r2.stdout + r2.stderr);
  const rm = child("__removeAndExit", f);
  check("子进程 C 删除成功", /removed/.test(rm.stdout), rm.stdout + rm.stderr);
  const r3 = child("__read", f);
  check("删除对后续进程可见（读到 null）", /null/.test(r3.stdout), r3.stdout + r3.stderr);
}

// [5] 原子写：落盘后不留 .tmp
{
  const f = P("atomic.json");
  const kv = createFileKv(f, { debounceMs: 20 });
  await kv.set("a", { v: 1 });
  kv.flush();
  await sleep(60);
  const leftovers = readdirSync(ROOT).filter((x) => x.startsWith("atomic.json.tmp"));
  check("落盘后没有残留 .tmp（原子写生效）", leftovers.length === 0, leftovers);
  check("落盘内容是合法 JSON", (() => {
    try {
      return typeof JSON.parse(readFileSync(f, "utf8")) === "object";
    } catch {
      return false;
    }
  })());
}

// [6] 损坏自愈：文件被写坏时插件不该起不来
{
  const f = P("corrupt.json");
  writeFileSync(f, "{ 这不是合法 JSON", "utf8");
  const kv = createFileKv(f, { debounceMs: 20 });
  check("损坏文件不阻塞创建（插件不因此起不来）", (await kv.get("any")) === null);
  const backups = readdirSync(ROOT).filter((x) => x.startsWith("corrupt.json.corrupt-"));
  check("损坏文件被改名留档（可追溯）", backups.length === 1, backups);
}

// [7] 防抖合并：连续写多次只落一次盘
{
  const f = P("debounce.json");
  const kv = createFileKv(f, { debounceMs: 60 });
  for (let i = 0; i < 5; i++) await kv.set("k" + i, { i });
  await sleep(140);
  const obj = JSON.parse(readFileSync(f, "utf8"));
  check("防抖窗口内的 5 次写入全部落盘（不丢）", Object.keys(obj).length === 5, Object.keys(obj));
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
