// 真实用户数据脱敏：npm run eval:deid -- [原始文件] [--out 输出文件]
//
// 默认读 evals/persona-card/private/real-raw.json（格式见 templates/real-raw.example.json），
// 写到 evals/persona-card/dataset/real.jsonl。两个文件都在 .gitignore 里，不会被提交。
//
// 做的事：
//   1. 没有 consent: true 的用户整条跳过
//   2. 本人名字 → “我”（聊天记录里）或删掉；其他人的名字 → 某人A、某人B
//   3. secrets 里列的词（小区名、公司名、学校名……）→ [已隐藏]
//   4. 手机号（中国 / 新加坡）、邮箱、NRIC/FIN、门牌号、邮编 → 占位符
//   5. 扫一遍剩下可能漏掉的（英文专有名词、长数字、敏感词），写到 private/deid-review.md，你人工过一眼再用

import fs from "node:fs";
import path from "node:path";
import { redact } from "../../lib/privacy.mjs";
import { isSensitive } from "../../lib/socialState.mjs";
import { CONFIG, DATASET_DIR, PRIVATE_DIR, writeJSONL, parseArgs } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
const input = args._[0] || path.join(PRIVATE_DIR, "real-raw.json");
const output = args.out || path.join(DATASET_DIR, "real.jsonl");
if (!fs.existsSync(input)) {
  console.error(`找不到 ${input}。把 templates/real-raw.example.json 复制到 private/real-raw.json，填上真实数据再运行。`);
  process.exit(1);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PII = CONFIG.piiPatterns.map((p) => ({ name: p.name, re: new RegExp(p.re, "g") }));

function scrub(text, { selfNames = [], others = new Map(), secrets = [], chat = false }) {
  let t = String(text || "");
  // 长的先换，避免“小明”先于“小明同学”被替换
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) if (s) t = t.replace(new RegExp(escapeRe(s), "gi"), "[已隐藏]");
  for (const [name, alias] of [...others].sort((a, b) => b[0].length - a[0].length)) t = t.replace(new RegExp(escapeRe(name), "gi"), alias);
  for (const n of [...selfNames].sort((a, b) => b.length - a.length)) {
    if (!n) continue;
    // 聊天记录里本人的名字一律换成“我”，这样隐私闸门能认出本人消息（含 QQ 导出的消息头）
    t = t.replace(new RegExp(escapeRe(n), "gi"), chat ? "我" : "[本人]");
  }
  for (const p of PII) t = t.replace(p.re, `[${p.name}]`);
  return redact(t).text;
}

function suspicious(text) {
  const out = [];
  for (const m of String(text).matchAll(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)*\b/g)) out.push(`英文专有名词？「${m[0]}」`);
  for (const m of String(text).matchAll(/\d{4,}/g)) out.push(`长数字「${m[0]}」`);
  for (const line of String(text).split("\n")) if (isSensitive(line)) out.push(`敏感词「${line.slice(0, 30)}」`);
  return out;
}

const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const users = Array.isArray(raw) ? raw : raw.users;
const cases = [];
const review = ["# 脱敏复查", "", "下面是脱敏后仍可能有问题的地方。确认没问题（比如“Taylor Swift”是兴趣不是人名）就不用管；有问题就把词加到这个用户的 secrets 里，重新运行 `npm run eval:deid`。", ""];
let skipped = 0;
users.forEach((u, idx) => {
  if (u.consent !== true) {
    skipped += 1;
    return;
  }
  const id = `real-${String(cases.length + 1).padStart(2, "0")}`;
  const others = new Map((u.otherNames || []).map((n, i) => [n, `某人${String.fromCharCode(65 + i)}`]));
  const opts = { selfNames: u.names || [], others, secrets: u.secrets || [] };
  const c = { id, tags: ["real", u.chatText ? "paste" : "guided", ...(u.tags || [])], source: u.chatText ? "chat_paste" : "guided" };
  if (u.chatText) {
    c.chatText = scrub(u.chatText, { ...opts, chat: true });
    c.selfNames = [];
  } else {
    c.answers = (u.answers || []).map((a) => ({ q: a.q, answer: scrub(a.answer, opts), ...(a.followupAnswer ? { followupAnswer: scrub(a.followupAnswer, opts) } : {}) }));
  }
  if (u.expect) c.expect = u.expect;
  if (u.feedback) {
    const f = u.feedback;
    c.human = { faithfulness: f.faithfulness ?? null, tone: f.tone ?? null, privacy: f.privacy ?? null, note: scrub(f.note || "", opts) };
  }
  c.note = `第 ${idx + 1} 位真实用户（脱敏）`;
  cases.push(c);
  const text = c.chatText || c.answers.map((a) => `${a.answer}\n${a.followupAnswer || ""}`).join("\n");
  const flags = suspicious(text);
  if (flags.length) review.push(`## ${id}`, "", ...flags.map((f) => `- ${f}`), "");
});

writeJSONL(output, cases);
fs.mkdirSync(PRIVATE_DIR, { recursive: true });
fs.writeFileSync(path.join(PRIVATE_DIR, "deid-review.md"), review.join("\n") + "\n");
console.log(`已脱敏 ${cases.length} 位用户 → ${path.relative(process.cwd(), output)}${skipped ? `（${skipped} 位没有 consent: true，已跳过）` : ""}`);
console.log(`请过一眼 ${path.relative(process.cwd(), path.join(PRIVATE_DIR, "deid-review.md"))}，再跑 npm run eval:card -- --set real`);
