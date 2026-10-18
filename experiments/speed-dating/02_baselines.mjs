// 第 2 步：不用大模型的基线
//  B0 随机
//  B1 规则打分（兴趣相似度 + 偏好契合 + 年龄差 + 同专业，权重事先拍定）
//  B2 逻辑回归（按“波次”分 5 折交叉验证：训练和测试的人来自不同场次活动，避免同一个人同时出现在训练和测试里）
// 用法：node experiments/speed-dating/02_baselines.mjs

import { P, readJSON, writeJSON, rng } from "./lib/util.mjs";
import { pairFeatures, ruleScore, trainLogReg, FEATURE_NAMES } from "./lib/features.mjs";
import { auc } from "./lib/metrics.mjs";

const people = readJSON(P.people);
const pairs = readJSON(P.pairs);
const sampleIds = new Set(readJSON(P.sample).ids);

const X = pairs.map((p) => pairFeatures(people[p.a], people[p.b]));
const y = pairs.map((p) => p.match);
const fold = pairs.map((p) => p.wave % 5);

const oof = new Array(pairs.length).fill(NaN);
const weightsByFold = [];
for (let k = 0; k < 5; k += 1) {
  const tr = pairs.map((_, i) => i).filter((i) => fold[i] !== k);
  const te = pairs.map((_, i) => i).filter((i) => fold[i] === k);
  const model = trainLogReg(tr.map((i) => X[i]), tr.map((i) => y[i]));
  weightsByFold.push(model.weights);
  for (const i of te) oof[i] = model.predict(X[i]);
}

const rand = rng(1);
const preds = {};
pairs.forEach((p, i) => {
  if (!sampleIds.has(p.id)) return;
  preds[p.id] = { B0_random: rand(), B1_rule: ruleScore(people[p.a], people[p.b]), B2_logreg: oof[i] };
});

const avgWeights = FEATURE_NAMES.map((name, j) => ({ name, weight: weightsByFold.reduce((acc, w) => acc + w[j], 0) / 5 }))
  .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

const fullAUC = {
  B1_rule: auc(pairs.map((p) => ruleScore(people[p.a], people[p.b])), y),
  B2_logreg: auc(oof, y),
};

writeJSON(P.predBaselines, { predictions: preds, fullPopulation: { n: pairs.length, auc: fullAUC }, logregWeights: avgWeights });
console.log(`基线预测已写入（评测集 ${Object.keys(preds).length} 对）`);
console.log(`全量 ${pairs.length} 对上的 AUC：规则 ${fullAUC.B1_rule.toFixed(3)}，逻辑回归(交叉验证) ${fullAUC.B2_logreg.toFixed(3)}`);
console.log("逻辑回归最重要的特征：", avgWeights.slice(0, 5).map((w) => `${w.name}(${w.weight.toFixed(2)})`).join("、"));
