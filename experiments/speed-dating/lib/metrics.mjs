// 评估指标：AUC（Mann-Whitney，含并列处理）、分层 bootstrap 置信区间、配对差值检验、Top-K 命中率。

import { rng } from "./util.mjs";

export function auc(scores, labels) {
  const idx = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rankSumPos = 0;
  let nPos = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      if (idx[k][1] === 1) {
        rankSumPos += avgRank;
        nPos += 1;
      }
    }
    i = j + 1;
  }
  const nNeg = idx.length - nPos;
  if (!nPos || !nNeg) return NaN;
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/** 排名前 frac 的样本里正样本占比（平衡样本下随机水平为 50%） */
export function precisionAtTop(scores, labels, frac = 0.2) {
  const k = Math.max(1, Math.round(scores.length * frac));
  const order = scores.map((s, i) => [s, labels[i], i]).sort((a, b) => b[0] - a[0] || a[2] - b[2]);
  return order.slice(0, k).reduce((acc, x) => acc + x[1], 0) / k;
}

const pct = (arr, q) => {
  const s = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/**
 * 分层 bootstrap：每次在正、负样本内部各自有放回抽样，所有方法共用同一组重抽样下标，
 * 因此可以直接计算两两 AUC 差值的置信区间（配对比较）。
 * @param {Record<string, number[]>} scoreMap  方法名 -> 分数数组（顺序与 labels 对齐）
 */
export function bootstrapAUC(scoreMap, labels, { iters = 2000, seed = 7, pairs = [] } = {}) {
  const rand = rng(seed);
  const posIdx = labels.map((l, i) => (l === 1 ? i : -1)).filter((i) => i >= 0);
  const negIdx = labels.map((l, i) => (l === 0 ? i : -1)).filter((i) => i >= 0);
  const names = Object.keys(scoreMap);
  const samples = Object.fromEntries(names.map((n) => [n, []]));
  const diffs = Object.fromEntries(pairs.map(([x, y]) => [`${x} vs ${y}`, []]));
  for (let t = 0; t < iters; t += 1) {
    const pick = [
      ...posIdx.map(() => posIdx[Math.floor(rand() * posIdx.length)]),
      ...negIdx.map(() => negIdx[Math.floor(rand() * negIdx.length)]),
    ];
    const lab = pick.map((i) => labels[i]);
    const cur = {};
    for (const n of names) {
      cur[n] = auc(pick.map((i) => scoreMap[n][i]), lab);
      samples[n].push(cur[n]);
    }
    for (const [x, y] of pairs) diffs[`${x} vs ${y}`].push(cur[x] - cur[y]);
  }
  const summary = Object.fromEntries(
    names.map((n) => [n, { auc: auc(scoreMap[n], labels), lo: pct(samples[n], 0.025), hi: pct(samples[n], 0.975) }])
  );
  const deltas = Object.fromEntries(
    pairs.map(([x, y]) => {
      const d = diffs[`${x} vs ${y}`];
      const pNotBetter = d.filter((v) => v <= 0).length / d.length; // 单侧：x 不优于 y 的比例
      return [`${x} vs ${y}`, { delta: auc(scoreMap[x], labels) - auc(scoreMap[y], labels), lo: pct(d, 0.025), hi: pct(d, 0.975), pOneSided: pNotBetter }];
    })
  );
  return { summary, deltas };
}
