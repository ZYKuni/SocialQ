// 两次评测对比：npm run eval:compare -- <旧结果目录> <新结果目录> [--judge]
// 不给目录就比最近两次。改 prompt / 换模型后用它看“变好还是变差、哪些用例变了”。
// --judge：对两边都生成出卡的用例做两两比较（每条正反各问一次裁判，抵消位置偏差）。

import fs from "node:fs";
import path from "node:path";
import { createJudge, pairwise, DIMS, DIM_NAMES } from "./lib/judge.mjs";
import { readJSONL, RESULTS_DIR, parseArgs, loadEnv, createDiskCache, pool, pct, fix } from "./lib/util.mjs";

loadEnv();
const args = parseArgs(process.argv.slice(2));
let [a, b] = args._;
if (!a || !b) {
  const all = fs.readdirSync(RESULTS_DIR).filter((d) => fs.existsSync(path.join(RESULTS_DIR, d, "summary.json"))).sort();
  if (all.length < 2) throw new Error("至少要有两次评测结果");
  [a, b] = all.slice(-2).map((d) => path.join(RESULTS_DIR, d));
}
const load = (dir) => ({
  dir,
  name: path.basename(dir),
  ...JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8")),
  rows: readJSONL(path.join(dir, "results.jsonl")).filter((r) => r.repeat === 0),
});
const A = load(a);
const B = load(b);

const L = [`# 对比：${A.name} → ${B.name}`, ""];
L.push(`- 旧：${A.meta.model}，代码 ${A.meta.commit}，指纹 ${A.meta.fingerprint}`);
L.push(`- 新：${B.meta.model}，代码 ${B.meta.commit}，指纹 ${B.meta.fingerprint}`);
if (A.meta.judgeModel !== B.meta.judgeModel) L.push(`- ⚠️ 两次的裁判模型不同（${A.meta.judgeModel} / ${B.meta.judgeModel}），分数不能直接比`);
L.push("", "| 指标 | 旧 | 新 | |", "|---|---|---|---|");
for (const g of B.summary.gates) {
  const old = A.summary.gates.find((x) => x.name === g.name);
  const better = old?.value == null || g.value == null ? "" : g.value === old.value ? "＝" : (g.name.includes("失败") ? g.value < old.value : g.value > old.value) ? "⬆️" : "⬇️";
  L.push(`| ${g.name} | ${old?.shown ?? "—"} | ${g.shown} | ${better} |`);
}
L.push(`| 用例通过率 | ${pct(A.summary.passRate)} | ${pct(B.summary.passRate)} | |`);
L.push("");

const oldById = new Map(A.rows.map((r) => [r.id, r]));
const common = B.rows.filter((r) => oldById.has(r.id));
const regress = common.filter((r) => oldById.get(r.id).pass && !r.pass);
const fixed = common.filter((r) => !oldById.get(r.id).pass && r.pass);
L.push(`## 变差的用例（${regress.length}）`, "");
for (const r of regress) L.push(`- **${r.id}**：${r.failReasons.join("；")}`);
L.push("", `## 变好的用例（${fixed.length}）`, "");
for (const r of fixed) L.push(`- **${r.id}**`);
L.push("", "## 裁判分变化 ≥ 1 的", "", "| 用例 | " + DIMS.map((d) => DIM_NAMES[d]).join(" | ") + " |", "|---|" + DIMS.map(() => "---").join("|") + "|");
for (const r of common) {
  const o = oldById.get(r.id);
  const cells = DIMS.map((d) => [o.judge?.[d]?.score, r.judge?.[d]?.score]);
  if (!cells.some(([x, y]) => x != null && y != null && Math.abs(x - y) >= 1)) continue;
  L.push(`| ${r.id} | ${cells.map(([x, y]) => (x === y ? `${y ?? "—"}` : `${x ?? "—"} → **${y ?? "—"}**`)).join(" | ")} |`);
}
L.push("");

if (args.judge) {
  const judge = createJudge({ cache: createDiskCache() });
  const both = common.filter((r) => r.state || oldById.get(r.id).state);
  console.log(`两两比较 ${both.length} 条（每条 2 次调用）…`);
  const res = await pool(both, 4, async (r) => ({ id: r.id, ...(await pairwise(judge, { source: r.source }, r.userText, oldById.get(r.id).state, r.state)) }));
  const tally = { A: 0, B: 0, tie: 0 };
  for (const x of res) tally[x.winner] += 1;
  L.push(`## 两两比较（裁判 ${judge.model}）`, "", `新版更好 ${tally.B} 条，旧版更好 ${tally.A} 条，平局 ${tally.tie} 条。`, "");
  for (const x of res.filter((x) => x.winner !== "tie")) L.push(`- ${x.id}：${x.winner === "B" ? "新版" : "旧版"}更好。${x.reason}`);
  L.push("");
}

const out = path.join(B.dir, "compare.md");
fs.writeFileSync(out, L.join("\n"));
console.log(L.slice(0, 16).join("\n"));
console.log(`\n详细：${out}`);
