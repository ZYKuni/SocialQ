// 汇总指标、对照门槛、写 report.md。

import { CONFIG, mean, pct, fix, squash } from "./util.mjs";
import { DIMS, DIM_NAMES } from "./judge.mjs";

const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const ratio = (a, b) => (b ? a / b : null);
const quantile = (xs, q) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null;
};

/** 同一用例多次生成之间，兴趣集合的 Jaccard 相似度（衡量输出稳定性） */
function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}
const interestKeys = (state) => (state?.interests || []).map((i) => `${i.category}|${squash(i.entity || i.type || "")}`);

export function summarize(rows) {
  const main = rows.filter((r) => r.repeat === 0);
  const m = (k) => sum(main.map((r) => r.metrics?.[k]));
  const judged = (dim) => main.map((r) => r.judge?.[dim]?.score).filter((x) => Number.isFinite(x));

  const byGroup = (keyFn) => {
    const groups = {};
    for (const r of main) for (const k of [].concat(keyFn(r))) (groups[k] ||= []).push(r);
    return Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, { n: rs.length, passed: rs.filter((r) => r.pass).length }]));
  };

  const checkStats = {};
  for (const r of main) {
    for (const c of r.checks) {
      const id = c.id.replace(/「.*」/, "「…」").replace(/\d+-\d+/, "x-y");
      const s = (checkStats[id] ||= { dim: c.dim, severity: c.severity, n: 0, pass: 0 });
      s.n += 1;
      if (c.pass) s.pass += 1;
    }
  }

  const droppedReasons = {};
  for (const r of main) for (const d of r.dropped || []) droppedReasons[d.reason] = (droppedReasons[d.reason] || 0) + 1;

  // 稳定性：只在 --repeat > 1 时有
  const stability = [];
  for (const r of main) {
    const others = rows.filter((x) => x.id === r.id && x.repeat > 0);
    for (const o of others) stability.push(jaccard(interestKeys(r.state), interestKeys(o.state)));
  }

  const human = main.filter((r) => r.human);
  const s = {
    cases: main.length,
    sets: byGroup((r) => r.set),
    tags: byGroup((r) => r.tags || []),
    passRate: ratio(main.filter((r) => r.pass).length, main.length),
    parseRate: ratio(main.filter((r) => r.metrics?.parsed).length, main.length),
    rawItemValidRate: ratio(m("rawItemsValid"), m("rawItems")),
    rawEvidenceRate: ratio(m("rawEvidenceVerbatim"), m("rawEvidence")),
    entityGroundedRate: ratio(m("entitiesGrounded"), m("entities")),
    entityRecall: ratio(m("expectedEntitiesHit"), m("expectedEntities")),
    hardFailCases: main.filter((r) => r.checks.some((c) => c.severity === "hard" && !c.pass)).length,
    judge: Object.fromEntries(
      DIMS.map((d) => {
        const xs = judged(d);
        return [d, { mean: mean(xs), n: xs.length, dist: [1, 2, 3, 4, 5].map((k) => xs.filter((x) => x === k).length) }];
      })
    ),
    checkStats,
    droppedReasons,
    stability: stability.length ? { pairs: stability.length, meanJaccard: mean(stability), parseRateAll: ratio(rows.filter((r) => r.metrics?.parsed).length, rows.length) } : null,
    humanCases: human.length,
    cost: {
      promptTokens: sum(rows.map((r) => r.usage?.promptTokens)),
      completionTokens: sum(rows.map((r) => r.usage?.completionTokens)),
      judgeTokens: sum(main.flatMap((r) => DIMS.map((d) => (r.judge?.[d]?.usage?.promptTokens || 0) + (r.judge?.[d]?.usage?.completionTokens || 0)))),
      latencyP50: quantile(rows.map((r) => r.latencyMs).filter(Boolean), 0.5),
      latencyP90: quantile(rows.map((r) => r.latencyMs).filter(Boolean), 0.9),
    },
  };
  s.gates = gates(s);
  return s;
}

export function gates(s) {
  const g = CONFIG.gates;
  const rows = [
    ["JSON 解析成功率", s.parseRate, g.parseRate, ">=", pct],
    ["硬规则失败的用例数", s.hardFailCases, g.hardFailCases, "<=", (x) => String(x)],
    ["证据是原话的比例（校验前）", s.rawEvidenceRate, g.rawEvidenceRate, ">=", pct],
    ["预期具体对象召回率", s.entityRecall, g.entityRecall, ">=", pct],
    ["忠实度均分", s.judge.faithfulness.mean, g.faithfulnessMean, ">=", fix],
    ["隐私均分", s.judge.privacy.mean, g.privacyMean, ">=", fix],
    ["语气均分", s.judge.tone.mean, g.toneMean, ">=", fix],
  ];
  return rows.map(([name, value, target, op, f]) => ({
    name,
    value,
    target,
    shown: value == null ? "—" : f(value),
    targetShown: `${op} ${f(target)}`,
    ok: value == null ? null : op === ">=" ? value >= target : value <= target,
  }));
}

/** 一个字段一行、数组里每个对象一行，比完整缩进好读 */
export function compactJSON(obj) {
  if (!obj) return "null";
  const fields = Object.entries(obj).map(([k, v]) =>
    Array.isArray(v) && v.some((x) => x && typeof x === "object")
      ? `  "${k}": [\n${v.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`
      : `  "${k}": ${JSON.stringify(v)}`
  );
  return `{\n${fields.join(",\n")}\n}`;
}

const mark = (ok) => (ok == null ? "⚪" : ok ? "✅" : "❌");
const esc = (t) => String(t ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderReport(meta, s, rows) {
  const main = rows.filter((r) => r.repeat === 0);
  const L = [];
  L.push(`# 分身卡生成评测报告：${meta.label}`);
  L.push("");
  L.push(`- 时间：${meta.time}　代码版本：${meta.commit}　生成代码指纹：${meta.fingerprint}`);
  L.push(`- 生成模型：${meta.model}　裁判模型：${meta.judgeModel}${meta.mock ? "　**（演示模式：没有调用真实模型，分数不代表质量）**" : ""}`);
  L.push(`- 用例：${s.cases} 条（${Object.entries(s.sets).map(([k, v]) => `${k} ${v.n}`).join("，")}）　重复次数：${meta.repeat}`);
  L.push("");
  const failedGates = s.gates.filter((g) => g.ok === false);
  L.push(`## 结论：${failedGates.length ? `❌ ${failedGates.length} 项没达标` : "✅ 全部达标"}　用例通过率 ${pct(s.passRate)}`);
  L.push("");
  L.push("| 指标 | 结果 | 门槛 | |");
  L.push("|---|---|---|---|");
  for (const g of s.gates) L.push(`| ${g.name} | ${g.shown} | ${g.targetShown} | ${mark(g.ok)} |`);
  L.push("");
  L.push(`其他：原始条目字段合规率 ${pct(s.rawItemValidRate)}，最终卡具体对象可溯源率 ${pct(s.entityGroundedRate)}。`);
  L.push("");

  L.push("## 分组通过率");
  L.push("");
  L.push("| 分组 | 通过 / 总数 |");
  L.push("|---|---|");
  for (const [k, v] of Object.entries(s.sets)) L.push(`| 数据集 ${k} | ${v.passed} / ${v.n} |`);
  const tagRows = Object.entries(s.tags).sort((a, b) => a[1].passed / a[1].n - b[1].passed / b[1].n);
  for (const [k, v] of tagRows.filter(([, v]) => v.passed < v.n)) L.push(`| 标签 ${k} | ${v.passed} / ${v.n} |`);
  L.push("");
  const allOk = tagRows.filter(([, v]) => v.passed === v.n).map(([k]) => k);
  if (allOk.length) L.push(`全部通过的标签：${allOk.join("、")}`, "");

  L.push("## 裁判打分分布");
  L.push("");
  L.push("| 维度 | 均分 | 1 | 2 | 3 | 4 | 5 |");
  L.push("|---|---|---|---|---|---|---|");
  for (const d of DIMS) L.push(`| ${DIM_NAMES[d]} | ${fix(s.judge[d].mean)} | ${s.judge[d].dist.join(" | ")} |`);
  L.push("");

  L.push("## 代码检查");
  L.push("");
  L.push("| 检查 | 维度 | 级别 | 通过率 |");
  L.push("|---|---|---|---|");
  for (const [id, c] of Object.entries(s.checkStats).sort((a, b) => a[0].localeCompare(b[0]))) L.push(`| ${id} | ${DIM_NAMES[c.dim]} | ${c.severity === "hard" ? "硬" : "软"} | ${c.pass}/${c.n} |`);
  L.push("");
  if (Object.keys(s.droppedReasons).length) {
    L.push(`**被 validateState 拦下的模型输出：** ${Object.entries(s.droppedReasons).map(([k, v]) => `${k} ${v} 条`).join("，")}。拦下说明校验在起作用，但数字上升说明 prompt 在退化。`);
    L.push("");
  }

  const failed = main.filter((r) => !r.pass);
  L.push(`## 没通过的用例（${failed.length}）`);
  L.push("");
  for (const r of failed) {
    L.push(`### ${r.id}　${(r.tags || []).join(" · ")}`);
    if (r.note) L.push(`> ${r.note}`);
    for (const reason of r.failReasons) L.push(`- ${reason}`);
    for (const d of DIMS) {
      const j = r.judge?.[d];
      if (!j || j.score == null || j.score >= CONFIG.pass[d]) continue;
      for (const i of j.issues || []) L.push(`  - ${DIM_NAMES[d]}：\`${esc(i.field)}\` ${esc(i.quote)} → ${esc(i.problem)}`);
    }
    L.push("");
    L.push("<details><summary>输入和卡</summary>");
    L.push("");
    L.push("```");
    L.push(r.userText);
    L.push("```");
    L.push("");
    L.push("```json");
    L.push(compactJSON(r.stateForJudge));
    L.push("```");
    L.push("</details>");
    L.push("");
  }

  if (s.stability) {
    L.push("## 稳定性");
    L.push("");
    L.push(`同一输入重复生成 ${meta.repeat} 次：兴趣集合平均 Jaccard ${fix(s.stability.meanJaccard)}（1 表示每次抽到的兴趣完全一样），所有次数的 JSON 解析成功率 ${pct(s.stability.parseRateAll)}。`);
    L.push("");
  }
  if (s.humanCases) {
    L.push("## 人工分");
    L.push("");
    L.push(`有 ${s.humanCases} 条用例带人工分。用 \`npm run eval:calibrate -- ${meta.dirRel}\` 看裁判和人工的一致性。`);
    L.push("");
  }
  L.push("## 成本");
  L.push("");
  L.push(`生成 token ${s.cost.promptTokens} + ${s.cost.completionTokens}，裁判 token ${s.cost.judgeTokens}（缓存命中的不计）。单次生成延迟 p50 ${s.cost.latencyP50 ?? "—"} ms，p90 ${s.cost.latencyP90 ?? "—"} ms。`);
  L.push("");
  return L.join("\n");
}
