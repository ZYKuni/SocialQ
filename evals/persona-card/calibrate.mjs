// 裁判校准：npm run eval:calibrate -- [结果目录]
//
// 把人工逐条填的 1/0（human-review.csv，由 npm run eval:card -- --export-human 12 导出）和裁判的逐条结论对答案。
// 真实用户自带的“语气像不像我”（human.toneOk）也会用上。
//
// 看两个数：
//   一致率   裁判和人结论相同的比例
//   漏判率   人说有问题的里面，裁判却放过了多少。这是危险的那一种错，比误杀重要
// 门槛在 config.json 的 calibration。不达标就改 rubrics/ 里对应的标准，重跑再校准。

import fs from "node:fs";
import path from "node:path";
import { readHumanCSV } from "./lib/human.mjs";
import { DIM_NAMES } from "./lib/judge.mjs";
import { readJSONL, pct, RESULTS_DIR, CONFIG, parseArgs } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
let dir = args._[0];
if (!dir) {
  const all = fs.existsSync(RESULTS_DIR) ? fs.readdirSync(RESULTS_DIR).filter((d) => fs.existsSync(path.join(RESULTS_DIR, d, "human-review.csv"))).sort() : [];
  if (!all.length) {
    console.log("没有找到 human-review.csv。先跑 npm run eval:card -- --export-human 12，填好 ok 列再来。");
    process.exit(0);
  }
  dir = path.join(RESULTS_DIR, all.at(-1));
}
const rows = readJSONL(path.join(dir, "results.jsonl")).filter((r) => r.repeat === 0);
const byId = new Map(rows.map((r) => [r.id, r]));

// 每一对：{ group, id, what, human(ok?), judge(ok?), judgeWhy, note }
const pairs = [];
const csv = path.join(dir, "human-review.csv");
if (fs.existsSync(csv)) {
  for (const h of readHumanCSV(csv)) {
    const r = byId.get(h.id);
    if (!r) continue;
    const f = r.judge?.faithfulness;
    if (h.kind === "item") {
      const it = f?.detail?.items?.find((x) => x.n === h.n);
      if (it?.verdict) pairs.push({ group: "faithfulness", id: h.id, what: it.text, human: h.ok, judge: it.verdict === "ok", judgeWhy: it.why, note: h.note });
    } else if (h.kind === "missed") {
      if (f?.score != null) pairs.push({ group: "missed", id: h.id, what: "重要遗漏", human: h.ok, judge: !f.detail.missed.some((m) => m.major), judgeWhy: f.detail.missed.map((m) => m.what).join("、"), note: h.note });
    } else if (h.kind === "tone" || h.kind === "privacy") {
      const j = r.judge?.[h.kind];
      if (j?.score != null) pairs.push({ group: h.kind, id: h.id, what: DIM_NAMES[h.kind], human: h.ok, judge: j.score >= CONFIG.pass[h.kind], judgeWhy: j.reason, note: h.note });
    }
  }
}
for (const r of rows) {
  const j = r.judge?.tone;
  if (typeof r.human?.toneOk === "boolean" && j?.score != null) pairs.push({ group: "tone", id: r.id, what: "语气（本人反馈）", human: r.human.toneOk, judge: j.score >= CONFIG.pass.tone, judgeWhy: j.reason, note: r.human.note || "" });
}
if (!pairs.length) {
  console.log(`没有可比较的人工结论。在 ${csv} 的 ok 列填 1 或 0 再运行。`);
  process.exit(0);
}

const NAMES = { faithfulness: "忠实（逐条）", missed: "遗漏", tone: "语气", privacy: "隐私" };
const { minAgreement, maxMissRate } = CONFIG.calibration;
const L = [`# 裁判校准：${path.basename(dir)}`, "", `门槛：一致率 ≥ ${pct(minAgreement)}，漏判率 ≤ ${pct(maxMissRate)}。样本少于 10 的维度只作参考。`, "", "| 维度 | 样本 | 一致率 | 人说有问题 | 其中裁判放过（漏判） | 裁判误杀 | 判读 |", "|---|---|---|---|---|---|---|"];
for (const g of Object.keys(NAMES)) {
  const p = pairs.filter((x) => x.group === g);
  if (!p.length) continue;
  const agree = p.filter((x) => x.human === x.judge).length / p.length;
  const bad = p.filter((x) => !x.human);
  const missed = bad.filter((x) => x.judge).length;
  const overkill = p.filter((x) => x.human && !x.judge).length;
  const missRate = bad.length ? missed / bad.length : null;
  const verdict = p.length < 10 ? "⚪ 样本太少" : agree >= minAgreement && (missRate == null || missRate <= maxMissRate) ? "✅ 可信" : "❌ 先改 rubric";
  L.push(`| ${NAMES[g]} | ${p.length} | ${pct(agree)} | ${bad.length} | ${missed}${missRate == null ? "" : `（${pct(missRate)}）`} | ${overkill} | ${verdict} |`);
}
const show = (x) => `- **${x.id}** ${x.what}${x.note ? `　人工备注：${x.note}` : ""}${x.judgeWhy ? `　裁判：${x.judgeWhy}` : ""}`;
const misses = pairs.filter((x) => !x.human && x.judge);
const kills = pairs.filter((x) => x.human && !x.judge);
L.push("", `## 裁判放过、人说有问题的（${misses.length}）`, "", "这是要优先处理的：rubric 里没写到这种情况，或者写得不够明确。", "", ...(misses.length ? misses.map(show) : ["没有。"]));
L.push("", `## 裁判判有问题、人说没问题的（${kills.length}）`, "", "裁判太严：在 rubric 的“不算问题”里补一条。", "", ...(kills.length ? kills.map(show) : ["没有。"]));
L.push("", "改完 rubric 后重跑 `npm run eval:card`（rubric 变了缓存会自动失效），再导出、再校准一次。只需要重看这次有分歧的条目。");
const out = path.join(dir, "calibration.md");
fs.writeFileSync(out, L.join("\n") + "\n");
console.log(L.slice(0, 6 + Object.keys(NAMES).length).join("\n"));
console.log(`\n详细：${out}`);
