// 评测脚本共用的小工具：路径、读 .env、JSONL、磁盘缓存、并发池、文本归一。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_DIR = path.resolve(EVAL_DIR, "..", "..");
export const DATASET_DIR = path.join(EVAL_DIR, "dataset");
export const RESULTS_DIR = path.join(EVAL_DIR, "results");
export const RUBRIC_DIR = path.join(EVAL_DIR, "rubrics");
export const PRIVATE_DIR = path.join(EVAL_DIR, "private");

export const CONFIG = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "config.json"), "utf8"));

/** 读取项目根目录的 .env.local / .env（不覆盖已有环境变量） */
export function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT_DIR, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}

export function readJSONL(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l, i) => [l.trim(), i + 1])
    .filter(([l]) => l && !l.startsWith("//"))
    .map(([l, n]) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${path.basename(file)} 第 ${n} 行不是合法 JSON：${e.message}`);
      }
    });
}

export function writeJSONL(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** 追加写入的 JSONL 缓存：同样的请求（同 prompt、同模型、同参数）只调用一次模型。prompt 一改，key 自动变。 */
export function createDiskCache(file = path.join(EVAL_DIR, ".cache", "llm-cache.jsonl"), salt = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const map = new Map();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const { k, v } = JSON.parse(line);
        map.set(k, v);
      } catch {
        /* 忽略中断写入造成的半行 */
      }
    }
  }
  return {
    keyOf: (payload) => crypto.createHash("sha256").update(salt + JSON.stringify(payload)).digest("hex"),
    get: (k) => map.get(k),
    set: (k, v) => {
      map.set(k, v);
      fs.appendFileSync(file, `${JSON.stringify({ k, v })}\n`);
    },
    size: () => map.size,
  };
}

export async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return out;
}

/** 和 lib/socialState.mjs 一样的归一：小写、去空格和标点 */
export const squash = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

export const mean = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);
export const fix = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) args[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[k] = argv[++i];
    else args[k] = true;
  }
  return args;
}

export function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
