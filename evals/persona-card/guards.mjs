// 规则层测试：npm run eval:guards
// 不调模型、不花钱、几十毫秒跑完。测的是“模型出了坏输出时，代码拦不拦得住”：
//   redact    —— lib/privacy.mjs 的隐私闸门
//   validate  —— lib/socialState.mjs 的 validateState
// 模型评测（eval:card）里发现的坏例子，只要能靠规则拦住，就该在这里加一条，而不是指望 prompt。
// 加 --strict：有失败时退出码非 0（CI 用）。

import fs from "node:fs";
import path from "node:path";
import { redact } from "../../lib/privacy.mjs";
import { validateState, visibleTo } from "../../lib/socialState.mjs";
import { DATASET_DIR, CONFIG, squash, parseArgs } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
const data = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "guards.json"), "utf8"));
const results = [];
const check = (id, note, problems) => results.push({ id, note: note || "", ok: problems.length === 0, problems });
const inText = (hay, needle) => squash(hay).includes(squash(needle));

for (const c of data.redact) {
  const out = redact(c.text).text;
  const problems = [
    ...(c.forbidden || []).filter((x) => inText(out, x)).map((x) => `没脱敏「${x}」`),
    ...(c.keep || []).filter((x) => !inText(out, x)).map((x) => `误伤「${x}」`),
  ];
  check(c.id, c.text, problems.length ? [...problems, `输出：${out}`] : []);
}

for (const c of data.validate) {
  const today = CONFIG.today;
  // 和线上一样：原话先过隐私闸门，再进校验
  const userText = redact(c.userText).text;
  const { state } = validateState(c.raw, { userText, source: c.source || "guided", today });
  const all = JSON.stringify(state);
  const shared = JSON.stringify(visibleTo(state, "others", today));
  const problems = [
    ...(c.forbidden || []).filter((x) => inText(all, x)).map((x) => `卡上出现「${x}」`),
    ...(c.sharedForbidden || []).filter((x) => inText(shared, x)).map((x) => `对外可见部分出现「${x}」`),
    ...(c.keep || []).filter((x) => !inText(all, x)).map((x) => `误删「${x}」`),
    ...(typeof c.expectInterests === "number" && state.interests.length !== c.expectInterests ? [`兴趣 ${state.interests.length} 条，期望 ${c.expectInterests}`] : []),
  ];
  check(c.id, c.note, problems);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.id}　${r.note}`);
  for (const p of r.problems) console.log(`    ${p}`);
}
console.log(`\n规则层：${results.length - failed.length}/${results.length} 通过${failed.length ? "。没通过的是代码里的确定性漏洞，改 lib/privacy.mjs 或 lib/socialState.mjs 就能修，不用等模型评测。" : ""}`);
if (args.strict && failed.length) process.exit(1);
