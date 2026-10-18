// 实验脚本用到的 Node 工具：路径、.env 读取、磁盘缓存、并发池、随机数、CSV 解析。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const EXP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_DIR = path.resolve(EXP_DIR, "..", "..");
export const P = {
  rawCsv: path.join(EXP_DIR, "data", "raw", "speed_dating.csv"),
  people: path.join(EXP_DIR, "data", "people.json"),
  pairs: path.join(EXP_DIR, "data", "pairs.json"),
  sample: path.join(EXP_DIR, "data", "sample.json"),
  cache: path.join(EXP_DIR, "data", "cache", "llm-cache.jsonl"),
  predBaselines: path.join(EXP_DIR, "results", "predictions", "baselines.json"),
  predLLM: path.join(EXP_DIR, "results", "predictions", "llm.jsonl"),
  results: path.join(EXP_DIR, "results", "results.json"),
  report: path.join(EXP_DIR, "results", "report.md"),
};

export function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJSON(file, data) {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

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

/** 追加写入的 JSONL 缓存：同样的请求只调用一次模型，重跑免费、结果可复现 */
export function createDiskCache(file = P.cache) {
  ensureDir(file);
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
    size: () => map.size,
    keyOf: (obj) => crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex"),
    get: (k) => map.get(k),
    set: (k, v) => {
      map.set(k, v);
      fs.appendFileSync(file, `${JSON.stringify({ k, v })}\n`);
    },
  };
}

export async function runPool(items, concurrency, worker) {
  let next = 0;
  const results = new Array(items.length);
  async function lane() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** RFC 4180 CSV 解析，兼容 \r / \r\n / \n 换行和带逗号的引号字段 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
