// 社交状态（人格卡 v2 的 state 字段）：校验、归一化、速通卡、按披露级别过滤。
// 规则来自 skills/persona-card/SKILL.md；词表和兴趣分类直接读 skills/icebreak-topics/ 下的 JSON，只有一个来源。
// 纯函数，前端（速通卡、确认页）和后端（大模型抽取后的校验）共用。

import taxonomy from "../skills/icebreak-topics/taxonomy.json" with { type: "json" };
import lexicon from "../skills/icebreak-topics/lexicon.json" with { type: "json" };

export const CARD_VERSION = 2;
export const DISCLOSURES = ["public", "match", "self_agent", "none"];
export const SHARED = new Set(["public", "match"]);

export const CATEGORIES = taxonomy.categories.map((c) => ({ id: c.id, name: c.name, types: c.types, entityKinds: c.entityKinds }));
const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const EVIDENCE_MAX = 20;
export const QUICK_EVIDENCE = "点选";
export const QUICK_LEVEL = 6;

// 和 lib/agents.mjs 里的禁止推断项一致（icebreak-topics H3）：命中就整条丢弃
const SENSITIVE =
  /大学|学院|中学|小学|学校|校区|住在|小区|宿舍楼|门牌|宗教|信仰|基督|佛教|伊斯兰|党员|政治|政党|抑郁|焦虑症|确诊|医院|吃药|怀孕|性取向|同性恋|异性恋|双性恋|民族|汉族|\d{1,2}\s*岁|年龄/;

const squash = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

const str = (v, max) => String(v ?? "").trim().slice(0, max);

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function categoryName(id) {
  return CATEGORY_BY_ID.get(id)?.name || id;
}

export function isSensitive(...texts) {
  return texts.some((t) => t && SENSITIVE.test(String(t)));
}

/** 证据必须是用户原话的一部分（忽略空格、标点和大小写）。 */
export function evidenceInText(evidence, userText) {
  const e = squash(evidence);
  return e.length > 0 && squash(userText).includes(e);
}

/** 用 lexicon.json 把别名归一到 canonical。词表里没有的保留原话，popularity 记 unknown。 */
export function normalizeEntity(text) {
  const raw = str(text, 40);
  if (!raw) return null;
  const key = squash(raw);
  for (const e of lexicon.entities) {
    if (squash(e.canonical) === key || e.aliases.some((a) => squash(a) === key)) {
      return { canonical: e.canonical, category: e.category, popularity: e.popularity };
    }
  }
  return { canonical: raw, category: null, popularity: "unknown" };
}

/** 在一段话里找出词表收录的实体（演示模式和速通卡输入框用）。 */
export function findLexiconEntities(text) {
  const t = squash(text);
  const hits = [];
  for (const e of lexicon.entities) {
    const names = [e.canonical, ...e.aliases].sort((a, b) => b.length - a.length);
    const hit = names.find((n) => squash(n).length >= 2 && t.includes(squash(n)));
    if (hit) hits.push({ canonical: e.canonical, category: e.category, popularity: e.popularity, matched: hit });
  }
  return hits;
}

function disclosureOf(value, fallback) {
  return DISCLOSURES.includes(value) ? value : fallback;
}

const interestKey = (i) => `${i.category}|${squash(i.entity || i.type || "")}`;

/**
 * 把大模型返回的社交状态过一遍 SKILL.md 第 5 步的自查清单。
 * @param {object} raw            大模型返回的 JSON
 * @param {object} opts
 * @param {string} opts.userText  用户本人说过的全部原话，用来核对证据
 * @param {"guided"|"chat_paste"|"quick"} opts.source
 * @param {string} [opts.today]
 * @returns {{ state: object, dropped: {kind:string, item:string, reason:string}[] }}
 */
export function validateState(raw, { userText = "", source = "guided", today = todayISO() } = {}) {
  const r = raw || {};
  const dropped = [];
  const drop = (kind, item, reason) => dropped.push({ kind, item: String(item || "").slice(0, 40), reason });
  // 粘贴来源一律先给“仅自己的分身”，用户确认后才升级（SKILL.md 四级披露）
  const defaultDisclosure = source === "chat_paste" ? "self_agent" : "match";
  const forced = source === "chat_paste" ? "self_agent" : null;
  const needEvidence = source !== "quick";

  const checkEvidence = (kind, label, evidence) => {
    const ev = str(evidence, 200);
    if (!needEvidence) return QUICK_EVIDENCE;
    if (!ev) {
      drop(kind, label, "没有原话证据");
      return null;
    }
    if (!evidenceInText(ev, userText)) {
      drop(kind, label, "证据不在用户原话里");
      return null;
    }
    return ev.slice(0, EVIDENCE_MAX);
  };

  const extra = Array.isArray(r.extra) ? r.extra.map((x) => str(x, 40)).filter(Boolean) : [];

  const interests = [];
  const seen = new Set();
  for (const item of Array.isArray(r.interests) ? r.interests : []) {
    const label = item?.entity || item?.type || item?.category;
    const cat = CATEGORY_BY_ID.get(item?.category);
    if (!cat) {
      if (label) extra.push(str(label, 40));
      drop("interest", label, "大类不在 taxonomy.json 里，已移到 extra");
      continue;
    }
    if (isSensitive(item.entity, item.type, item.evidence)) {
      drop("interest", label, "包含敏感信息");
      continue;
    }
    const evidence = checkEvidence("interest", label, item.evidence);
    if (!evidence) continue;
    const type = cat.types.includes(item.type) ? item.type : null;
    const norm = item.entity ? normalizeEntity(item.entity) : null;
    const level = Math.round(Number(item.level));
    const next = {
      category: cat.id,
      type,
      entity: norm?.canonical || null,
      level: Number.isFinite(level) ? Math.max(1, Math.min(10, level)) : 6,
      recentAt: isDate(item.recentAt) ? item.recentAt : null,
      evidence,
      source,
      disclosure: forced || disclosureOf(item.disclosure, defaultDisclosure),
      popularity: norm?.popularity || "unknown",
    };
    if (next.disclosure === "none") continue;
    const key = interestKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    interests.push(next);
  }

  const situations = [];
  for (const item of Array.isArray(r.situations) ? r.situations : []) {
    const text = str(item?.text, 20);
    if (!text) continue;
    if (isSensitive(text, item.evidence)) {
      drop("situation", text, "包含敏感信息");
      continue;
    }
    const evidence = checkEvidence("situation", text, item.evidence);
    if (!evidence) continue;
    situations.push({
      text,
      expiresAt: isDate(item.expiresAt) && item.expiresAt >= today ? item.expiresAt : addDays(today, 30),
      evidence,
      source,
      disclosure: forced || disclosureOf(item.disclosure, defaultDisclosure),
    });
  }

  const skills = [];
  for (const item of Array.isArray(r.skills) ? r.skills : []) {
    const name = str(item?.name, 20);
    if (!name || isSensitive(name)) continue;
    const evidence = checkEvidence("skill", name, item.evidence);
    if (!evidence) continue;
    skills.push({
      name,
      role: item.role === "expert" ? "expert" : "intermediate",
      evidence,
      source,
      disclosure: forced || disclosureOf(item.disclosure, defaultDisclosure),
    });
  }

  const words = (v, n = 8) =>
    (Array.isArray(v) ? v : [])
      .map((x) => str(typeof x === "string" ? x : x?.text || x?.name, 20))
      .filter((x) => x && !isSensitive(x))
      .slice(0, n);

  let style = null;
  if (r.style && (r.style.text || r.style.catchphrases)) {
    const catchphrases = (Array.isArray(r.style.catchphrases) ? r.style.catchphrases : [])
      .map((c) => str(c, EVIDENCE_MAX))
      .filter((c) => c && (!needEvidence || evidenceInText(c, userText)))
      .slice(0, 3);
    const conf = Number(r.style.confidence);
    style = {
      text: str(r.style.text, 60),
      catchphrases,
      // 只有三问的回答时风格证据很薄，置信度封顶 0.4（SKILL.md 第 3 步）
      confidence: Math.max(0, Math.min(source === "guided" ? 0.4 : 1, Number.isFinite(conf) ? conf : 0.3)),
      disclosure: "self_agent",
    };
  }

  const mbti = typeof r.mbti === "string" && /^[EIX][SNX][TFX][JPX]$/.test(r.mbti) ? r.mbti : null;

  const state = {
    selfIntro: isSensitive(r.selfIntro) ? "" : str(r.selfIntro, 40),
    lookingFor: isSensitive(r.lookingFor) ? "" : str(r.lookingFor, 60),
    interests,
    situations,
    skills,
    wantsToLearn: words(r.wantsToLearn),
    dislikes: words(r.dislikes),
    avoid: (Array.isArray(r.avoid) ? r.avoid : []).map((x) => str(x, 20)).filter(Boolean).slice(0, 8),
    style,
    mbti,
    extra: [...new Set(extra)].slice(0, 8),
  };
  return { state, dropped };
}

/** 是否达到“够用”：2 条带 entity 的兴趣，或 1 条带 entity 的兴趣 + 1 条未过期近况（只算对外可见的）。 */
export function isThin(state, today = todayISO()) {
  const entities = (state.interests || []).filter((i) => i.entity && i.level >= 5 && SHARED.has(i.disclosure)).length;
  const live = (state.situations || []).filter((s) => SHARED.has(s.disclosure) && (!s.expiresAt || s.expiresAt >= today)).length;
  return !(entities >= 2 || (entities >= 1 && live >= 1));
}

/**
 * 按披露级别过滤。
 * self：自己的分身，能看到除“不存”以外的全部；others：对方的分身、裁判、粗筛，只能看到公开和匹配可见。
 */
export function visibleTo(state, audience = "self", today = todayISO()) {
  const s = state || {};
  const ok = (x) => (audience === "self" ? x.disclosure !== "none" : SHARED.has(x.disclosure));
  return {
    selfIntro: s.selfIntro || "",
    lookingFor: s.lookingFor || "",
    interests: (s.interests || []).filter(ok),
    situations: (s.situations || []).filter((x) => ok(x) && (!x.expiresAt || x.expiresAt >= today)),
    skills: (s.skills || []).filter(ok),
    wantsToLearn: s.wantsToLearn || [],
    dislikes: s.dislikes || [],
    avoid: audience === "self" ? s.avoid || [] : [],
    style: audience === "self" ? s.style || null : null,
    mbti: audience === "self" ? s.mbti || null : null,
  };
}

/** 从 state 推导旧版人格卡的扁平字段，让匹配、mock 和实验代码不用改。 */
export function deriveLegacy(state) {
  const shared = visibleTo(state, "others");
  const interests = [...shared.interests]
    .sort((a, b) => b.level - a.level)
    .map((i) => ({ name: i.entity || i.type || categoryName(i.category), level: i.level }))
    .filter((i, idx, arr) => arr.findIndex((x) => x.name === i.name) === idx)
    .slice(0, 8);
  return {
    summary: state?.selfIntro || "",
    interests,
    dislikes: (state?.dislikes || []).slice(0, 6),
    style: state?.style?.text || "未知",
    lookingFor: state?.lookingFor || "未知",
    avoid: (state?.avoid || []).slice(0, 5),
  };
}

/**
 * 速通卡：点选大类（2 到 5 个）+ 可选类型 + 可选“最近在玩/在看的”。不调用大模型。
 * @param {{categories:string[], types?:Record<string,string[]>, recent?:string}} selection
 */
export function buildQuickState(selection, today = todayISO()) {
  const cats = [...new Set(selection?.categories || [])].filter((id) => CATEGORY_BY_ID.has(id)).slice(0, 5);
  const interests = [];
  for (const id of cats) {
    const allowed = CATEGORY_BY_ID.get(id).types;
    const types = (selection?.types?.[id] || []).filter((t) => allowed.includes(t));
    const base = { category: id, entity: null, level: QUICK_LEVEL, recentAt: null, evidence: QUICK_EVIDENCE, source: "quick", disclosure: "match", popularity: "unknown" };
    if (types.length) types.forEach((type) => interests.push({ ...base, type }));
    else interests.push({ ...base, type: null });
  }
  const extra = [];
  const recent = str(selection?.recent, 30);
  if (recent && !isSensitive(recent)) {
    const hit = findLexiconEntities(recent)[0];
    const norm = hit || normalizeEntity(recent);
    if (norm?.category) {
      interests.unshift({
        category: norm.category,
        type: null,
        entity: norm.canonical,
        level: QUICK_LEVEL,
        recentAt: today,
        evidence: recent.slice(0, EVIDENCE_MAX),
        source: "quick",
        disclosure: "match",
        popularity: norm.popularity,
      });
    } else {
      extra.push(`最近在玩/在看：${recent}`);
    }
  }
  return {
    selfIntro: "",
    lookingFor: "",
    interests,
    situations: [],
    skills: [],
    wantsToLearn: [],
    dislikes: [],
    avoid: [],
    style: null,
    mbti: null,
    extra,
  };
}

/**
 * 把新抽出的条目并进已有的 state，同一个对象只保留一条（已有的优先）。
 * 默认（粘贴聊天记录）新条目一律是“仅自己的分身”并标 pending，等用户在确认页决定；
 * review: false 时（用户在确认页自己补一句）保留抽取时的默认可见范围。
 */
export function mergeStates(base, incoming, { review = true } = {}) {
  const b = base || {};
  const keys = new Set((b.interests || []).map(interestKey));
  const pend = review ? (x) => ({ ...x, disclosure: "self_agent", pending: true }) : (x) => x;
  const newInterests = (incoming?.interests || []).filter((i) => !keys.has(interestKey(i))).map(pend);
  const sitKeys = new Set((b.situations || []).map((s) => squash(s.text)));
  const newSituations = (incoming?.situations || []).filter((s) => !sitKeys.has(squash(s.text))).map(pend);
  const skillKeys = new Set((b.skills || []).map((s) => squash(s.name)));
  const newSkills = (incoming?.skills || []).filter((s) => !skillKeys.has(squash(s.name))).map(pend);
  const uniq = (a, c) => [...new Set([...(a || []), ...(c || [])])].slice(0, 8);
  return {
    state: {
      ...b,
      interests: [...(b.interests || []), ...newInterests],
      situations: [...(b.situations || []), ...newSituations],
      skills: [...(b.skills || []), ...newSkills],
      wantsToLearn: uniq(b.wantsToLearn, incoming?.wantsToLearn),
      dislikes: uniq(b.dislikes, incoming?.dislikes),
      avoid: uniq(b.avoid, incoming?.avoid),
      style: incoming?.style?.text ? { ...incoming.style, disclosure: "self_agent" } : b.style || null,
      mbti: b.mbti || incoming?.mbti || null,
      extra: uniq(b.extra, incoming?.extra),
    },
    added: newInterests.length + newSituations.length + newSkills.length,
  };
}

/**
 * 组装 v2 人格卡：v2 字段 + 从 state 推导的旧字段。
 * 旧字段之外的东西（traits、basics）原样带过来。
 */
export function buildCard({ state, tier = "full", source = "guided", name = "我的claw", id, version = 1, traits, confirmedAt = null, createdAt, today = todayISO() }) {
  return {
    cardVersion: CARD_VERSION,
    tier,
    version,
    createdAt: createdAt || today,
    confirmedAt,
    thin: isThin(state, today),
    state,
    id: id || `u_${Math.random().toString(36).slice(2, 8)}`,
    name,
    source,
    ...(traits ? { traits } : {}),
    ...deriveLegacy(state),
  };
}

/** 确认页上的编辑：改可见范围、删除、改热度。返回新的 state，不改原对象。 */
export function updateItem(state, kind, index, patch) {
  const list = [...(state[kind] || [])];
  if (!list[index]) return state;
  if (patch === null) list.splice(index, 1);
  else list[index] = { ...list[index], ...patch, pending: false };
  return { ...state, [kind]: list };
}
