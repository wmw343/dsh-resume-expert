/**
 * 文件型 KV 存储 —— DSH 适配层的会话持久化。
 *
 * ## 为什么不是 SQLite（决策留痕 2026-09-18）
 *
 * - 数据形态就是一个 KV（`resume-expert/v1/{user}/{sessionId}` → 草稿对象）+ TTL，
 *   没有查询、没有关系、单进程访问——SQLite 的能力用不上；
 * - `node:sqlite` 在 Node 22.19 上需要 `--experimental-sqlite` 启动参数，
 *   而 `dsh web` 是用户自己启动的，插件改不了它的启动参数——用 SQLite 会把
 *   「能不能持久化」变成环境运气问题；
 * - 零依赖是这个包的卖点，JSON 文件方案同样零依赖。
 *
 * ## 可靠性设计
 *
 * - **原子写入**：先写 `.tmp` 再 rename——进程崩溃也不会留下半截文件；
 * - **防抖落盘**：400ms 合并高频写，避免每轮对话都刷盘；
 * - **退出兜底**：`process.once("exit")` 时补一次 flush（含防抖窗口内的脏数据）；
 * - **损坏自愈**：文件解析失败时改名备份、从空开始——插件不该因为存储文件而挂。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

interface Entry {
  value: unknown;
  /** 0 = 永不过期 */
  expiresAt: number;
}

export interface KvStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  remove(key: string): Promise<void>;
  /** 立即落盘（测试/退出前用） */
  flush(): void;
}

export function createFileKv(filePath: string, opts?: { debounceMs?: number }): KvStore {
  const debounceMs = opts?.debounceMs ?? 400;
  mkdirSync(path.dirname(filePath), { recursive: true });

  const map = new Map<string, Entry>();
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, Entry>;
      const now = Date.now();
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === "object" && (v.expiresAt === 0 || v.expiresAt > now)) map.set(k, v);
      }
    }
  } catch {
    // 文件损坏：改名留档，从空开始（简历可以重建，插件不能因此起不来）
    try {
      renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
      /* 备份失败也不阻塞启动 */
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  function persist() {
    if (!dirty) return;
    dirty = false;
    const obj: Record<string, Entry> = {};
    for (const [k, v] of map) obj[k] = v;
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj), "utf8");
    renameSync(tmp, filePath);
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      persist();
    }, debounceMs);
    // 不因为这个定时器阻止进程退出
    if (typeof timer.unref === "function") timer.unref();
  }

  process.once("exit", () => {
    if (timer) clearTimeout(timer);
    persist();
  });

  const alive = (e: Entry | undefined): e is Entry => !!e && (e.expiresAt === 0 || e.expiresAt > Date.now());

  return {
    async get<T>(key: string): Promise<T | null> {
      const e = map.get(key);
      if (!alive(e)) {
        if (e) {
          map.delete(key); // 惰性清除过期项
          schedule();
        }
        return null;
      }
      return e.value as T;
    },
    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      map.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
      schedule();
    },
    async remove(key: string): Promise<void> {
      if (map.delete(key)) schedule();
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      persist();
    },
  };
}
