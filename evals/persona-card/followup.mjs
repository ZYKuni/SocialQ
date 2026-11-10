// 追问环节评测：npm run eval:followup
// 分身卡的质量一半取决于追问有没有把具体对象问出来。这里测 decideFollowup：
//   1. 该追问的追问了、不该追问的没追问（和 questions.md 的规则对照）
//   2. 追问的话合规：不超过 30 字、不问敏感信息、不出现产品黑话、不夸奖、不复述
// 每条用例 1 次模型调用，结果走缓存。加 --mock 用演示模式。

import fs from "node:fs";
import path from "node:path";
import { createLLM, getLLMConfig } from "../../lib/llm.mjs";
import { decideFollowup } from "../../lib/agents.mjs";
import { DATASET_DIR, RESULTS_DIR, loadEnv, readJSONL, createDiskCache, pool, parseArgs, stamp, pct, squash } from "./lib/util.mjs";

loadEnv();
const args = parseArgs(process.argv.slice(2));
const config = args.mock ? { provider: "mock" } : getLLMConfig();
if (!args.mock && config.provider === "mock") {
  console.error("没有找到 LLM_API_KEY。在 .env.local 里配置，或者加 --mock。");
  process.exit(1);
}
const llm = createLLM({ config, cache: createDiskCache() });
const cases = readJSONL(path.join(DATASET_DIR, "followup.jsonl"));

const RULES = [
  ["超过 30 字", (t) => [...t].length > 30],
  ["问了敏感信息", (t) => /城市|学校|大学|年龄|多大|几岁|MBTI|哪里人|住哪|公司|单位/i.test(t)],
  ["出现产品黑话", (t) => /人格卡|标签|数据|分身卡/.test(t)],
  ["夸奖", (t) => /^(哇|好棒|真不错|厉害|太酷)|好棒|真棒|很棒/.test(t)],
];

const rows = await pool(cases, 4, async (c) => {
  try {
    const r = await decideFollowup(llm, { question: c.q, answer: c.answer });
    const problems = [];
    if (r.action !== c.expect) problems.push(`应该${c.expect === "followup" ? "追问" : "直接下一题"}，实际${r.action === "followup" ? "追问了" : "没追问"}`);
    if (r.action === "followup") {
      for (const [name, bad] of RULES) if (bad(r.text)) problems.push(name);
      const a = squash(c.answer);
      if (a.length >= 4 && squash(r.text).includes(a)) problems.push("复述了用户的话");
    }
    return { ...c, action: r.action, text: r.text, problems };
  } catch (error) {
    return { ...c, action: null, text: "", problems: [`调用失败：${error.message}`] };
  }
});

const right = rows.filter((r) => r.action === r.expect).length;
const asked = rows.filter((r) => r.action === "followup");
const clean = asked.filter((r) => !r.problems.some((p) => !p.startsWith("应该"))).length;
const L = [`# 追问环节评测`, "", `- 模型：${llm.model}${args.mock ? "（演示模式，结果不代表质量）" : ""}`, `- 追问与否判断正确：${right}/${rows.length}（${pct(right / rows.length)}）`, `- 追问的话合规：${clean}/${asked.length}`, "", "| 用例 | 回答 | 期望 | 实际 | 追问的话 | 问题 |", "|---|---|---|---|---|---|"];
for (const r of rows) L.push(`| ${r.id} | ${r.answer.replace(/\|/g, "\\|")} | ${r.expect} | ${r.action ?? "—"} | ${r.text.replace(/\|/g, "\\|")} | ${r.problems.join("；")} |`);
const dir = path.join(RESULTS_DIR, `${stamp()}-followup`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "report.md"), L.join("\n") + "\n");
console.log(L.slice(2, 5).join("\n"));
for (const r of rows.filter((r) => r.problems.length)) console.log(`  ✗ ${r.id}「${r.answer}」→ ${r.text || "（没追问）"}：${r.problems.join("；")}`);
console.log(`\n报告：${path.relative(process.cwd(), path.join(dir, "report.md"))}`);
if (args.strict && rows.some((r) => r.problems.length)) process.exit(1);
