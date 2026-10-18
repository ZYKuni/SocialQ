// 人格卡（Persona Card）：App 和实验共用的中间表示。
// App：聊天记录 -> 大模型提炼 -> 人格卡
// 实验：Speed Dating 报名问卷 -> 模板转换 -> 人格卡
// 之后的 Agent 代聊、匹配判断都只读取人格卡，保证两条链路走的是同一套匹配逻辑。

export const TRAIT_LABELS = ["搞怪值", "真诚度", "好奇心", "梗感度", "夜猫子", "社交能量"];

/**
 * @typedef {object} PersonaCard
 * @property {string} id
 * @property {string} name
 * @property {"survey"|"chat"|"sample"} source
 * @property {string[]} basics        基本信息（每行一条）
 * @property {string} summary
 * @property {{name:string, level:number}[]} interests   level 1-10
 * @property {string[]} dislikes
 * @property {string} style           说话风格
 * @property {string} schedule        作息
 * @property {string} lookingFor      想认识什么样的人
 * @property {string[]} avoid         不想聊的话题
 * @property {{label:string, score:number, evidence:string}[]} traits
 * @property {string[]} extra         其他补充信息
 */

export function clampScore(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** 把大模型返回的 JSON 规整成合法的人格卡，防止缺字段或越界值进入后续流程。 */
export function normalizePersona(raw, { id, name, source = "chat" } = {}) {
  const r = raw || {};
  const interests = (Array.isArray(r.interests) ? r.interests : [])
    .map((item) => (typeof item === "string" ? { name: item, level: 8 } : { name: String(item?.name || ""), level: clampScore(item?.level ?? 8, 1, 10) }))
    .filter((item) => item.name)
    .slice(0, 8);
  const traitMap = new Map(
    (Array.isArray(r.traits) ? r.traits : []).map((t) => [String(t?.label || ""), t])
  );
  const traits = TRAIT_LABELS.map((label) => {
    const t = traitMap.get(label) || {};
    return { label, score: clampScore(t.score ?? 50), evidence: String(t.evidence || "证据不足").slice(0, 60) };
  });
  const list = (v, n = 5) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, n) : []);
  return {
    id: id || r.id || `u_${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || r.nickname || r.name || "我的claw").slice(0, 20),
    source,
    basics: list(r.basics, 6),
    summary: String(r.summary || "").slice(0, 80),
    interests,
    dislikes: list(r.dislikes, 6),
    style: String(r.style || "未知").slice(0, 80),
    schedule: String(r.schedule || "未知").slice(0, 60),
    lookingFor: String(r.lookingFor || r.looking_for || "未知").slice(0, 80),
    avoid: list(r.avoid, 5),
    traits,
    extra: list(r.extra, 8),
  };
}

/** 渲染成给大模型读的中文档案文本 */
export function renderPersona(card) {
  const lines = [`昵称：${card.name}`];
  if (card.basics?.length) lines.push(...card.basics);
  if (card.summary) lines.push(`一句话：${card.summary}`);
  if (card.interests?.length) {
    lines.push(`兴趣（1-10 分，越高越喜欢）：${card.interests.map((i) => `${i.name} ${i.level}`).join("、")}`);
  }
  if (card.dislikes?.length) lines.push(`不太感兴趣：${card.dislikes.join("、")}`);
  if (card.style && card.style !== "未知") lines.push(`说话风格：${card.style}`);
  if (card.schedule && card.schedule !== "未知") lines.push(`作息：${card.schedule}`);
  if (card.lookingFor && card.lookingFor !== "未知") lines.push(`想认识的人：${card.lookingFor}`);
  if (card.avoid?.length) lines.push(`不想聊的话题：${card.avoid.join("、")}`);
  if (card.extra?.length) lines.push(...card.extra);
  return lines.join("\n");
}

/** 兴趣标签相似度（Jaccard，按名字模糊匹配），App 端做候选粗筛用 */
export function interestOverlap(a, b) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, "");
  const high = (card) => new Map((card.interests || []).filter((i) => i.level >= 7).map((i) => [norm(i.name), i.name]));
  const A = high(a);
  const B = high(b);
  if (!A.size || !B.size) return { score: 0, shared: [] };
  const shared = [];
  for (const [x, label] of A) {
    for (const y of B.keys()) {
      if (x === y || x.includes(y) || y.includes(x)) {
        shared.push(label);
        break;
      }
    }
  }
  const union = A.size + B.size - shared.length;
  return { score: union ? shared.length / union : 0, shared };
}
