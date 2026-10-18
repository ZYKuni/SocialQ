// 第 4 步：计算指标，生成 results/results.json（App 的 /lab 页读取）和 results/report.md
// 用法：node experiments/speed-dating/04_evaluate.mjs

import fs from "node:fs";
import { P, readJSON, writeJSON } from "./lib/util.mjs";
import { auc, bootstrapAUC, precisionAtTop } from "./lib/metrics.mjs";

const ARMS = [
  { key: "B0_random", label: "随机", group: "基线", desc: "随机打分，AUC 理论值 0.5" },
  { key: "B1_rule", label: "规则打分", group: "基线", desc: "兴趣相似度 + 偏好契合 + 年龄差 + 同专业，权重事先拍定" },
  { key: "B2_logreg", label: "逻辑回归", group: "基线", desc: "15 个配对特征，按活动场次做 5 折交叉验证训练" },
  { key: "L1", label: "大模型只看档案", group: "大模型", desc: "裁判读双方档案，直接判断双方是否愿意再见" },
  { key: "L2_self", label: "分身代聊后自评", group: "大模型", desc: "两个分身代聊 6 句，各自站在主人角度判断，概率相乘" },
  { key: "L2_judge", label: "档案 + 代聊裁判", group: "大模型", desc: "裁判同时读档案和代聊记录（与 L1 只差代聊记录）" },
];
const COMPARE = [
  ["L2_judge", "L1", "代聊是否带来档案之外的信息"],
  ["L2_self", "L1", "分身自评 vs 只看档案"],
  ["L1", "B2_logreg", "大模型读档案 vs 机器学习"],
  ["L1", "B1_rule", "大模型读档案 vs 规则"],
  ["L2_judge", "B2_logreg", "完整方案 vs 机器学习"],
  ["B2_logreg", "B0_random", "机器学习 vs 随机"],
];

const pairs = new Map(readJSON(P.pairs).map((p) => [p.id, p]));
const sample = readJSON(P.sample).ids;
const base = readJSON(P.predBaselines);

// 读取大模型结果：优先真实模型；同一配对同一组取最后一条成功记录
const llmRecords = fs.existsSync(P.predLLM)
  ? fs.readFileSync(P.predLLM, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && !r.error)
  : [];
const realModels = [...new Set(llmRecords.map((r) => r.model).filter((m) => m !== "mock"))];
const model = realModels[0] || (llmRecords.length ? "mock" : null);
const byKey = new Map();
for (const r of llmRecords) if (r.model === model) byKey.set(`${r.id}|${r.arm}`, r);
const isMock = model === "mock";

const scores = {};
for (const id of sample) {
  const b = base.predictions[id];
  const l1 = byKey.get(`${id}|L1`);
  const l2 = byKey.get(`${id}|L2`);
  scores[id] = {
    ...b,
    ...(l1 ? { L1: (l1.aWantsB * l1.bWantsA) / 1e4 } : {}),
    ...(l2 ? { L2_self: (l2.selfA * l2.selfB) / 1e4, L2_judge: (l2.judgeAWantsB * l2.judgeBWantsA) / 1e4 } : {}),
  };
}

const available = ARMS.filter((a) => sample.some((id) => scores[id][a.key] !== undefined)).map((a) => a.key);
// 只在所有可用组都有结果的配对上比较，保证是配对比较
const evalIds = sample.filter((id) => available.every((k) => scores[id][k] !== undefined));
const labels = evalIds.map((id) => pairs.get(id).match);
const scoreMap = Object.fromEntries(available.map((k) => [k, evalIds.map((id) => scores[id][k])]));
const cmp = COMPARE.filter(([x, y]) => available.includes(x) && available.includes(y));
const boot = bootstrapAUC(scoreMap, labels, { pairs: cmp.map(([x, y]) => [x, y]) });

// 单向意愿：每个人是否对对方说 Yes（每对 2 条）
const directional = [];
const dirDefs = [
  ["L1", (r) => [r.aWantsB, r.bWantsA]],
  ["L2_self", (r) => [r.selfA, r.selfB]],
  ["L2_judge", (r) => [r.judgeAWantsB, r.judgeBWantsA]],
];
for (const [key, get] of dirDefs) {
  const armName = key === "L1" ? "L1" : "L2";
  const recs = evalIds.map((id) => [pairs.get(id), byKey.get(`${id}|${armName}`)]).filter(([, r]) => r);
  if (!recs.length) continue;
  const s = [];
  const y = [];
  for (const [p, r] of recs) {
    const [pa, pb] = get(r);
    s.push(pa, pb);
    y.push(p.decA, p.decB);
  }
  directional.push({ key, auc: auc(s, y), n: y.length });
}

// 成本与延迟
const cost = {};
for (const arm of ["L1", "L2"]) {
  const recs = evalIds.map((id) => byKey.get(`${id}|${arm}`)).filter(Boolean);
  if (!recs.length) continue;
  const avg = (f) => recs.reduce((acc, r) => acc + f(r), 0) / recs.length;
  cost[arm] = {
    promptTokensPerPair: Math.round(avg((r) => r.usage?.promptTokens || 0)),
    completionTokensPerPair: Math.round(avg((r) => r.usage?.completionTokens || 0)),
    secondsPerPair: Number((avg((r) => r.ms || 0) / 1000).toFixed(1)),
  };
}

// 典型案例（用于误差分析）
const examples = [];
if (available.includes("L2_judge")) {
  const rows = evalIds.map((id) => ({ id, s: scores[id].L2_judge, y: pairs.get(id).match, r: byKey.get(`${id}|L2`) }));
  const pick = (title, list) => list[0] && examples.push({ title, id: list[0].id, score: list[0].s, match: list[0].y, transcript: list[0].r.transcript, reasons: list[0].r.reasons, selfReasons: list[0].r.selfReasons });
  pick("预测高分且真的互选成功", rows.filter((x) => x.y === 1).sort((a, b) => b.s - a.s));
  pick("预测高分但实际没成（误报）", rows.filter((x) => x.y === 0).sort((a, b) => b.s - a.s));
  pick("预测低分但实际互选成功（漏报）", rows.filter((x) => x.y === 1).sort((a, b) => a.s - b.s));
}

// 自动结论
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "-");
const conclusions = [];
if (isMock) conclusions.push("⚠️ 大模型组使用的是 mock（演示模式），以下大模型相关数字没有意义，只说明流程能跑通。");
const best = [...available].sort((a, b) => boot.summary[b].auc - boot.summary[a].auc)[0];
const bestArm = ARMS.find((a) => a.key === best);
conclusions.push(`AUC 最高的是「${bestArm.label}」：${f3(boot.summary[best].auc)}（95% CI ${f3(boot.summary[best].lo)}–${f3(boot.summary[best].hi)}）。`);
if (boot.summary[best].auc < 0.62) {
  conclusions.push("所有方法都只比随机（0.5）好一点：只凭见面前的信息，很难预测两个人见面后会不会互相来电。这与 Joel、Eastwick、Finkel（2017）用机器学习分析快速约会数据得到的结论一致。产品上不应该展示“契合度 92%”这种精确数字。");
}
const verdict = (key, yes, no, none) => {
  const d = boot.deltas[key];
  if (!d) return;
  if (d.lo > 0) conclusions.push(`${yes}（AUC ${d.delta >= 0 ? "+" : ""}${f3(d.delta)}，95% CI ${f3(d.lo)}–${f3(d.hi)}）。`);
  else if (d.hi < 0) conclusions.push(`${no}（AUC ${f3(d.delta)}，95% CI ${f3(d.lo)}–${f3(d.hi)}）。`);
  else conclusions.push(`${none}（AUC 差 ${d.delta >= 0 ? "+" : ""}${f3(d.delta)}，95% CI ${f3(d.lo)}–${f3(d.hi)}，区间包含 0）。`);
};
verdict("L2_judge vs L1", "Agent 代聊带来了档案之外的增量信息：加上代聊记录后，预测显著变好", "加上代聊记录后预测反而变差：分身的对话可能引入了噪声（例如一味附和）", "没有证据表明代聊能提升预测：代聊的价值更可能在体验和破冰，而不是算得更准");
verdict("L1 vs B2_logreg", "大模型读档案的效果显著好于逻辑回归", "大模型读档案不如几行特征的逻辑回归，而后者几乎零成本", "大模型读档案和逻辑回归效果没有显著差别，但成本高得多");

const results = {
  generatedAt: new Date().toISOString(),
  model,
  mock: isMock,
  n: evalIds.length,
  nPos: labels.filter((l) => l === 1).length,
  nNeg: labels.filter((l) => l === 0).length,
  arms: ARMS.filter((a) => available.includes(a.key)).map((a) => ({
    ...a,
    auc: boot.summary[a.key].auc,
    lo: boot.summary[a.key].lo,
    hi: boot.summary[a.key].hi,
    top20: precisionAtTop(scoreMap[a.key], labels, 0.2),
  })),
  pending: ARMS.filter((a) => !available.includes(a.key)).map((a) => a.key),
  deltas: cmp.map(([x, y, label]) => ({ a: x, b: y, label, ...boot.deltas[`${x} vs ${y}`] })),
  directional,
  fullPopulation: base.fullPopulation,
  logregTopFeatures: base.logregWeights.slice(0, 6),
  cost,
  conclusions,
  examples,
};
writeJSON(P.results, results);

// Markdown 报告
const md = [];
md.push("# SocialQ 匹配验证报告：Agent 代聊能预测真人是否合得来吗？", "");
md.push(`生成时间：${results.generatedAt}　模型：${model || "（尚未运行大模型组）"}`, "");
if (isMock) md.push("> ⚠️ 本报告的大模型组使用 mock 模式生成，仅用于检查流程，**数字不代表真实效果**。配置 `LLM_API_KEY` 后重新运行第 3、4 步。", "");
md.push(`评测集：${results.n} 对（互选成功 ${results.nPos} / 未成功 ${results.nNeg}，分层抽样），标签为双方是否都选了 Yes。`, "");
md.push("## 结论", "", ...conclusions.map((c) => `- ${c}`), "");
md.push("## 各方法 AUC（双方互选）", "", "| 方法 | 说明 | AUC | 95% CI | 前 20% 命中率 |", "|---|---|---:|---|---:|");
for (const a of results.arms) md.push(`| ${a.label} | ${a.desc} | ${f3(a.auc)} | ${f3(a.lo)}–${f3(a.hi)} | ${(a.top20 * 100).toFixed(0)}% |`);
if (results.pending.length) md.push("", `尚未运行：${results.pending.join("、")}`);
md.push("", "前 20% 命中率：按分数排名前 20% 的配对里真的互选成功的比例；评测集正负各半，随机水平为 50%。", "");
if (results.deltas.length) {
  md.push("## 两两比较（配对 bootstrap，2000 次）", "", "| 比较 | 问题 | AUC 差 | 95% CI | 单侧 p |", "|---|---|---:|---|---:|");
  for (const d of results.deltas) md.push(`| ${d.a} − ${d.b} | ${d.label} | ${d.delta >= 0 ? "+" : ""}${f3(d.delta)} | ${f3(d.lo)}–${f3(d.hi)} | ${d.pOneSided.toFixed(3)} |`);
  md.push("");
}
if (directional.length) {
  md.push("## 单向意愿（每个人是否对对方说 Yes）", "", "| 方法 | AUC | 样本数 |", "|---|---:|---:|");
  for (const d of directional) md.push(`| ${d.key} | ${f3(d.auc)} | ${d.n} |`);
  md.push("");
}
md.push("## 参照：全量数据上的基线", "", `在全部 ${base.fullPopulation.n} 对可用配对上：规则打分 AUC ${f3(base.fullPopulation.auc.B1_rule)}，逻辑回归（按场次交叉验证）AUC ${f3(base.fullPopulation.auc.B2_logreg)}。`, "");
md.push(`逻辑回归权重最大的特征：${results.logregTopFeatures.map((w) => `${w.name}（${w.weight >= 0 ? "+" : ""}${w.weight.toFixed(2)}）`).join("、")}。`, "");
if (Object.keys(cost).length) {
  md.push("## 成本与延迟（每对平均）", "", "| 组 | 输入 token | 输出 token | 耗时（秒） |", "|---|---:|---:|---:|");
  for (const [k, c] of Object.entries(cost)) md.push(`| ${k} | ${c.promptTokensPerPair} | ${c.completionTokensPerPair} | ${c.secondsPerPair} |`);
  md.push("");
}
if (examples.length) {
  md.push("## 典型案例", "");
  for (const e of examples) {
    md.push(`### ${e.title}（${e.id}，L2-judge 分数 ${f3(e.score)}，实际${e.match ? "互选成功" : "未成功"}）`, "");
    md.push(...e.transcript.map((m) => `> **${m.speaker}**：${m.text}  `), "");
    if (e.reasons?.length) md.push(`裁判理由：${e.reasons.join("；")}`, "");
  }
}
md.push("## 局限", "");
md.push("- 数据是 2002–2004 年美国研究生的异性快速约会，SocialQ 的场景是中国年轻人交友，只能作为“见面前信息能否预测见面后是否互相有兴趣”的代理验证。");
md.push("- 见面后的决定很大程度取决于外貌和现场感觉，这些信息在见面前的档案里没有，任何方法都有天花板。");
md.push("- 人格卡由问卷模板生成，而不是由聊天记录提炼；这个实验验证的是“代聊 + 判断”这一层，不验证“从聊天记录提炼人格”那一层。");
md.push("- 同一个人会出现在多对配对里，bootstrap 置信区间会略微偏窄。");
md.push("");
fs.writeFileSync(P.report, md.join("\n"));

console.log(`评测完成：${results.n} 对，可用方法 ${available.join(", ")}`);
for (const a of results.arms) console.log(`  ${a.label.padEnd(12, "　")} AUC ${f3(a.auc)} [${f3(a.lo)}, ${f3(a.hi)}]`);
console.log("结论：");
for (const c of conclusions) console.log(`  - ${c}`);
console.log(`报告：${P.report}`);
