// 裁判校准：比较 LLM 裁判和人工打分。npm run eval:calibrate -- <结果目录>
//
// 人工分有两个来源，都会用上：
//   1. 结果目录里填好的 human-review.csv（npm run eval:card -- --export-human 10 导出）
//   2. 用例自带的 human 字段（真实用户自己给卡打的分，见 dataset/real.example.jsonl）
//
// 判读：某个维度“相差不超过 1 分”的比例低于 80%，或者裁判系统性偏高/偏低超过 0.5 分，就先改 rubric 再信它的分。

import fs from "node:fs";
import path from "node:path";
import { readHumanCSV } from "./lib/human.mjs";
import { DIMS, DIM_NAMES } from "./lib/judge.mjs";
import { readJSONL, mean, pct, fix, RESULTS_DIR, parseArgs } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
let dir = args._[0];
if (!dir) {
  const all = fs.existsSync(RESULTS_DIR) ? fs.readdirSync(RESULTS_DIR).filter((d) => fs.existsSync(path.join(RESULTS_DIR, d, "results.jsonl"))).sort() : [];
  if (!all.length) throw new Error("还没有评测结果，先跑 npm run eval:card");
  dir = path.join(RESULTS_DIR, all.at(-1));
}
const rows = readJSONL(path.join(dir, "results.jsonl")).filter((r) => r.repeat === 0);
const byId = new Map(rows.map((r) => [r.id, r]));

const pairs = []; // { id, dim, judge, human, from, note }
const csv = path.join(dir, "human-review.csv");
if (fs.existsSync(csv)) {
  for (const h of readHumanCSV(csv)) {
    const r = byId.get(h.id);
    if (!r) continue;
    for (const d of DIMS) if (h[d] != null && r.judge?.[d]?.score != null) pairs.push({ id: h.id, dim: d, judge: r.judge[d].score, human: h[d], from: "抽查", note: h.note });
  }
}
for (const r of rows) {
  for (const d of DIMS) {
    const hv = r.human?.[d];
    if (Number.isFinite(hv) && r.judge?.[d]?.score != null) pairs.push({ id: r.id, dim: d, judge: r.judge[d].score, human: hv, from: "本人", note: r.human?.note || "" });
  }
}
if (!pairs.length) {
  console.log(`没有可比较的人工分。先在 ${csv} 里填分，或者给真实用户用例加 human 字段。`);
  process.exit(0);
}

const lines = [`# 裁判校准：${path.basename(dir)}`, "", "| 维度 | 样本 | 完全一致 | 相差≤1 | 平均绝对误差 | 裁判偏高 | 判读 |", "|---|---|---|---|---|---|---|"];
for (const d of DIMS) {
  const p = pairs.filter((x) => x.dim === d);
  if (!p.length) continue;
  const within1 = p.filter((x) => Math.abs(x.judge - x.human) <= 1).length / p.length;
  const bias = mean(p.map((x) => x.judge - x.human));
  const ok = within1 >= 0.8 && Math.abs(bias) <= 0.5;
  lines.push(
    `| ${DIM_NAMES[d]} | ${p.length} | ${pct(p.filter((x) => x.judge === x.human).length / p.length)} | ${pct(within1)} | ${fix(mean(p.map((x) => Math.abs(x.judge - x.human))))} | ${bias > 0 ? "+" : ""}${fix(bias)} | ${ok ? "✅ 可信" : "❌ 先改 rubric"} |`
  );
}
lines.push("", "## 分歧最大的（相差 ≥ 2 分）", "");
const big = pairs.filter((x) => Math.abs(x.judge - x.human) >= 2).sort((a, b) => Math.abs(b.judge - b.human) - Math.abs(a.judge - a.human));
if (!big.length) lines.push("没有。");
for (const x of big) {
  const r = byId.get(x.id);
  lines.push(`- **${x.id}** ${DIM_NAMES[x.dim]}：裁判 ${x.judge}，人工 ${x.human}（${x.from}）${x.note ? `，备注：${x.note}` : ""}`);
  lines.push(`  - 裁判理由：${r.judge[x.dim].reason}`);
}
lines.push("", "看分歧时问自己：是裁判没看懂 rubric（改 rubric 措辞、加例子），还是 rubric 本身没写到这种情况（加一条规则）？改完重跑 `npm run eval:card` 再校准一次。");
const out = path.join(dir, "calibration.md");
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.slice(0, 2 + 2 + DIMS.length).join("\n"));
console.log(`\n详细：${out}`);
