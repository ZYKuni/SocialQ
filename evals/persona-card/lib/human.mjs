// 人工抽查（第二版）：和裁判做同一件事——逐条判“对 / 不对”，这样才能一条条对答案。
// 导出时不显示裁判的结论，避免先入为主。

import fs from "node:fs";
import path from "node:path";
import { DIMS, claimsOf } from "./judge.mjs";
import { compactJSON } from "./report.mjs";

/** 抽样：真实用户全要；其余一半挑裁判判出问题最多的，一半固定种子随机，保证有问题的和没问题的都有人看。 */
export function pickForHuman(rows, n) {
  const real = rows.filter((r) => r.set === "real" && r.state);
  const rest = rows.filter((r) => r.set !== "real" && r.state);
  const minScore = (r) => Math.min(...DIMS.map((d) => r.judge?.[d]?.score ?? 5));
  const low = [...rest].sort((a, b) => minScore(a) - minScore(b)).slice(0, Math.ceil(n / 2));
  const others = rest.filter((r) => !low.includes(r));
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shuffled = others.map((r) => [rand(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  return [...real, ...low, ...shuffled].slice(0, Math.max(n, real.length));
}

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function exportHuman(dir, rows, n) {
  const picked = pickForHuman(rows, n);
  const md = [
    "# 人工抽查",
    "",
    "对照“输入”，在同目录的 `human-review.csv` 里给每一行的 `ok` 列填 1（没问题）或 0（有问题），大约每条用例 1 分钟。",
    "",
    "- `item` 行：卡上的这一条，用户说过吗？位置和程度对吗？标准见 `rubrics/faithfulness.md`。",
    "- `missed` 行：用户明确说过的具体对象、近况、不想聊的话题，卡上都有吗？有重要遗漏填 0，并在 note 里写漏了什么。",
    "- `tone` 行：自述、想认识谁、说话风格，有没有套话或拔高？没有填 1。标准见 `rubrics/tone.md`。",
    "- `privacy` 行：有没有不该出现、或不该对外的内容？没有填 1。标准见 `rubrics/privacy.md`。",
    "",
    "先自己填，再看 report.md 里裁判的结论，不然容易被带偏。",
    "",
  ];
  const csv = ["id,kind,n,content,ok,note"];
  for (const r of picked) {
    const claims = claimsOf(r.state);
    md.push(`## ${r.id}　${(r.tags || []).join(" · ")}`, "", "**输入**", "", "```", r.userText, "```", "", "**逐条**", "");
    for (const c of claims) md.push(`${c.n}. ${c.text}`);
    if (!claims.length) md.push("（卡是空的）");
    md.push("", "<details><summary>完整的卡</summary>", "", "```json", compactJSON(r.stateForJudge), "```", "</details>", "");
    for (const c of claims) csv.push([r.id, "item", c.n, cell(c.text), "", ""].join(","));
    csv.push([r.id, "missed", "", cell("没有重要遗漏"), "", ""].join(","));
    csv.push([r.id, "tone", "", cell("语气没问题"), "", ""].join(","));
    csv.push([r.id, "privacy", "", cell("隐私没问题"), "", ""].join(","));
  }
  fs.writeFileSync(path.join(dir, "human-review.md"), md.join("\n"));
  fs.writeFileSync(path.join(dir, "human-review.csv"), "﻿" + csv.join("\n") + "\n");
  console.log(`已导出 ${picked.length} 条待人工判断：${path.join(dir, "human-review.md")}`);
}

/** 解析一行 CSV（支持双引号包裹和 "" 转义） */
function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 读回填好的 CSV。没填 ok 的行跳过。 */
export function readHumanCSV(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = parseLine(lines[0]).map((h) => h.trim());
  return lines
    .slice(1)
    .map((line) => Object.fromEntries(parseLine(line).map((v, i) => [header[i], v.trim()])))
    .filter((r) => r.ok === "1" || r.ok === "0")
    .map((r) => ({ id: r.id, kind: r.kind, n: r.n ? Number(r.n) : null, content: r.content, ok: r.ok === "1", note: r.note || "" }));
}
