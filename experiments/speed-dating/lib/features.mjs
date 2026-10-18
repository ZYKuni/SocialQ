// 配对特征（对称：交换 A/B 结果不变）。规则基线和逻辑回归基线共用。

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

export function pearson(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i += 1) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

// prefs 顺序 [外貌, 真诚, 聪明, 有趣, 上进, 共同爱好]；self 顺序 [外貌, 真诚, 有趣, 聪明, 上进]
function prefFit(prefs, otherSelf, interestCorr) {
  const other = [otherSelf[0], otherSelf[1], otherSelf[3], otherSelf[2], otherSelf[4], 5 + 5 * interestCorr];
  return prefs.reduce((acc, w, i) => acc + (w / 100) * other[i], 0); // 约 1-10：对方在“我看重的维度”上的自评加权分
}

export const FEATURE_NAMES = [
  "年龄差", "兴趣相关系数", "兴趣平均差", "同专业大类", "同职业方向",
  "偏好契合度(和)", "偏好契合度(小)", "自评吸引力(和)", "自评吸引力(小)", "自评有趣(和)",
  "想找约会的人数", "只图好玩的人数", "约会频率(和)", "外出频率(和)", "期待值(和)",
];

export function pairFeatures(A, B) {
  const a = A.f;
  const b = B.f;
  const corr = pearson(a.levels, b.levels);
  const l1 = mean(a.levels.map((v, i) => Math.abs(v - b.levels[i])));
  const fitAB = prefFit(a.prefs, b.self, corr);
  const fitBA = prefFit(b.prefs, a.self, corr);
  return [
    Math.abs(a.age - b.age),
    corr,
    l1,
    a.fieldCd !== null && a.fieldCd === b.fieldCd ? 1 : 0,
    a.careerC !== null && a.careerC === b.careerC ? 1 : 0,
    fitAB + fitBA,
    Math.min(fitAB, fitBA),
    a.self[0] + b.self[0],
    Math.min(a.self[0], b.self[0]),
    a.self[2] + b.self[2],
    [a.goal, b.goal].filter((g) => g === 3 || g === 4).length,
    [a.goal, b.goal].filter((g) => g === 1).length,
    8 - a.date + (8 - b.date),
    8 - a.goOut + (8 - b.goOut),
    a.expHappy + b.expHappy,
  ];
}

/**
 * 规则基线：事先拍定的权重，不看标签调参。
 * 共同兴趣（和 App 端候选粗筛同一思路）+ 双方是否是彼此看重的类型 + 年龄差 + 同专业。
 */
export function ruleScore(A, B) {
  const x = pairFeatures(A, B);
  const [ageDiff, corr, , sameField, , , fitMin] = x;
  return 1.0 * corr + 0.5 * ((fitMin - 6) / 2) - 0.1 * Math.max(0, ageDiff - 3) + 0.2 * sameField;
}

/** L2 正则逻辑回归（批量梯度下降），特征先标准化 */
export function trainLogReg(X, y, { l2 = 1e-2, iters = 800, lr = 0.2 } = {}) {
  const d = X[0].length;
  const mu = Array.from({ length: d }, (_, j) => mean(X.map((r) => r[j])));
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(mean(X.map((r) => (r[j] - mu[j]) ** 2))) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  let w = new Array(d).fill(0);
  let b = Math.log(mean(y) / (1 - mean(y)));
  for (let t = 0; t < iters; t += 1) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < Z.length; i += 1) {
      const z = b + Z[i].reduce((acc, v, j) => acc + v * w[j], 0);
      const p = 1 / (1 + Math.exp(-z));
      const e = p - y[i];
      gb += e;
      for (let j = 0; j < d; j += 1) gw[j] += e * Z[i][j];
    }
    w = w.map((wj, j) => wj - lr * (gw[j] / Z.length + l2 * wj));
    b -= lr * (gb / Z.length);
  }
  return {
    weights: w,
    predict: (x) => 1 / (1 + Math.exp(-(b + x.reduce((acc, v, j) => acc + ((v - mu[j]) / sd[j]) * w[j], 0)))),
  };
}
