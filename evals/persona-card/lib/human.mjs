// 人工抽查：导出待打分的用例（不显示裁判分，避免先入为主），读回人工分。

import fs from "node:fs";
import path from "node:path";
import { DIMS } from "./judge.mjs";
import { compactJSON } from "./report.mjs";

/** 抽样：真实用户全要；其余按裁判最低分从低到高、再随机补齐，保证低分和高分都有人看。 */
export function pickForHuman(rows, n) {
  const real = rows.filter((r) => r.set === "real");
  const rest = rows.filter((r) => r.set !== "real" && r.state);
  const minScore = (r) => Math.min(...DIMS.map((d) => r.judge?.[d]?.score ?? 5));
  const low = [...rest].sort((a, b) => minScore(a) - minScore(b)).slice(0, Math.ceil(n / 2));
  const others = rest.filter((r) => !low.includes(r));
  // 固定种子的洗牌，保证同一次运行导出的结果稳定
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shuffled = others.map((r) => [rand(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  return [...real, ...low, ...shuffled].slice(0, Math.max(n, real.length));
}

export function exportHuman(dir, rows, n) {
  const picked = pickForHuman(rows, n);
  const md = [
    "# 人工抽查",
    "",
    "逐条看“输入”和“卡”，按 `rubrics/` 里的标准给三个维度各打 1-5 分，填进同目录的 `human-review.csv`。",
    "先自己打，再看 report.md 里裁判的分，不然容易被带偏。",
    "",
  ];
  for (const r of picked) {
    md.push(`## ${r.id}　${(r.tags || []).join(" · ")}`, "", "**输入**", "", "```", r.userText, "```", "", "**卡**", "", "```json", compactJSON(r.stateForJudge), "```", "");
  }
  fs.writeFileSync(path.join(dir, "human-review.md"), md.join("\n"));
  const csv = ["id,faithfulness,tone,privacy,note", ...picked.map((r) => `${r.id},,,,`)];
  fs.writeFileSync(path.join(dir, "human-review.csv"), csv.join("\n") + "\n");
  console.log(`已导出 ${picked.length} 条待人工打分：${path.join(dir, "human-review.md")}`);
}

/** 读回填好的 CSV。只认 id 和三个维度的分，note 可选。 */
export function readHumanCSV(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].replace(/^﻿/, "").split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = Object.fromEntries(header.map((h, i) => [h, (cells[i] || "").trim()]));
    const out = { id: row.id, note: cells.slice(header.indexOf("note")).join(",").trim() };
    for (const d of DIMS) out[d] = row[d] ? Number(row[d]) : null;
    return out;
  });
}
