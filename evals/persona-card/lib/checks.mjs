// 代码检查：不花钱、确定性，每次都跑。
// 每条检查返回 { id, dim, severity, pass, detail }。severity=hard 的不过，整条用例直接判失败。
// dim：format（格式）、faithfulness（忠实）、privacy（隐私）、tone（语气）。

import taxonomy from "../../../skills/icebreak-topics/taxonomy.json" with { type: "json" };
import lexicon from "../../../skills/icebreak-topics/lexicon.json" with { type: "json" };
import { isSensitive, evidenceInText, visibleTo, EVIDENCE_MAX } from "../../../lib/socialState.mjs";
import { CONFIG, squash } from "./util.mjs";

const CATS = new Map(taxonomy.categories.map((c) => [c.id, c]));
const PII = CONFIG.piiPatterns.map((p) => ({ name: p.name, re: new RegExp(p.re, "g") }));
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 一个 entity 能不能在原话里找到：直接出现，或者词表里它的任一别名出现。 */
export function entityGrounded(entity, userText) {
  const t = squash(userText);
  const e = squash(entity);
  if (!e) return true;
  if (t.includes(e)) return true;
  const lex = lexicon.entities.find((x) => squash(x.canonical) === e || x.aliases.some((a) => squash(a) === e));
  if (lex && [lex.canonical, ...lex.aliases].some((n) => squash(n).length >= 2 && t.includes(squash(n)))) return true;
  // 模型把简称补成全称（“草东”→“草东没有派对”）：原话里有 entity 的前 2 个字以上的连续片段就算能对上
  for (let len = Math.min(e.length - 1, 6); len >= 2; len -= 1) {
    for (let i = 0; i + len <= e.length; i += 1) if (t.includes(e.slice(i, i + len))) return true;
  }
  return false;
}

/** 把一张卡里所有字符串拍平，带上字段路径，方便定位 */
function strings(obj, prefix = "") {
  const out = [];
  if (obj == null) return out;
  if (typeof obj === "string") return [[prefix, obj]];
  if (typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) out.push(...strings(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

// 期望里的关键词可以写成“a|b”，任一个对上就算
const alts = (kw) => String(kw).split("|").map(squash).filter(Boolean);
const has = (list, kw) => (list || []).some((x) => alts(kw).some((k) => squash(typeof x === "string" ? x : x?.text || x?.name || "").includes(k)));

export function runChecks(c, gen) {
  const out = [];
  const add = (id, dim, severity, pass, detail = "") => out.push({ id, dim, severity, pass: Boolean(pass), detail });
  const metrics = {};
  const raw = gen.raw;

  // ---------- 格式 ----------
  add("F1 返回合法 JSON", "format", "hard", !gen.error && raw && typeof raw === "object", gen.error || "");
  if (!raw || !gen.state) return { checks: out, metrics: { parsed: false } };
  metrics.parsed = true;

  const shape = {
    selfIntro: "string", lookingFor: "string", interests: "array", situations: "array", skills: "array",
    wantsToLearn: "array", dislikes: "array", avoid: "array",
  };
  const badKeys = Object.entries(shape).filter(([k, t]) => (t === "array" ? !Array.isArray(raw[k]) : typeof raw[k] !== t)).map(([k]) => k);
  add("F2 顶层字段齐全且类型对", "format", "soft", badKeys.length === 0, badKeys.length ? `缺失或类型不对：${badKeys.join("、")}` : "");

  // 逐条检查原始输出（校验前）里每个条目的字段
  const items = [];
  for (const i of Array.isArray(raw.interests) ? raw.interests : []) {
    const cat = CATS.get(i?.category);
    const problems = [];
    if (!cat) problems.push(`category=${i?.category}`);
    else if (i.type != null && !cat.types.includes(i.type)) problems.push(`type=${i.type}`);
    const lv = Number(i?.level);
    if (!Number.isInteger(lv) || lv < 1 || lv > 10) problems.push(`level=${i?.level}`);
    if (i?.recentAt != null && !isDate(i.recentAt)) problems.push(`recentAt=${i.recentAt}`);
    if (!i?.evidence || String(i.evidence).length > EVIDENCE_MAX) problems.push("evidence 缺失或超 20 字");
    items.push({ kind: "interest", label: i?.entity || i?.type || i?.category, evidence: i?.evidence, problems });
  }
  for (const s of Array.isArray(raw.situations) ? raw.situations : []) {
    const problems = [];
    if (!s?.text) problems.push("text 为空");
    if (s?.expiresAt != null && !isDate(s.expiresAt)) problems.push(`expiresAt=${s.expiresAt}`);
    if (!s?.evidence || String(s.evidence).length > EVIDENCE_MAX) problems.push("evidence 缺失或超 20 字");
    items.push({ kind: "situation", label: s?.text, evidence: s?.evidence, problems });
  }
  for (const s of Array.isArray(raw.skills) ? raw.skills : []) {
    const problems = [];
    if (!["expert", "intermediate"].includes(s?.role)) problems.push(`role=${s?.role}`);
    if (!s?.evidence || String(s.evidence).length > EVIDENCE_MAX) problems.push("evidence 缺失或超 20 字");
    items.push({ kind: "skill", label: s?.name, evidence: s?.evidence, problems });
  }
  const badItems = items.filter((x) => x.problems.length);
  metrics.rawItems = items.length;
  metrics.rawItemsValid = items.length - badItems.length;
  add("F3 原始条目字段合规", "format", "soft", badItems.length === 0, badItems.map((x) => `${x.label}: ${x.problems.join("，")}`).join("；"));
  const introLen = String(raw.selfIntro || "").length;
  add("F4 selfIntro 不超过 40 字", "format", "soft", introLen <= 40, `${introLen} 字`);

  // ---------- 忠实 ----------
  const withEv = items.filter((x) => x.evidence);
  const verbatim = withEv.filter((x) => evidenceInText(x.evidence, gen.userText));
  metrics.rawEvidence = items.length;
  metrics.rawEvidenceVerbatim = verbatim.length;
  const notVerbatim = items.filter((x) => !x.evidence || !evidenceInText(x.evidence, gen.userText));
  add("G1 原始输出的证据都是原话", "faithfulness", "soft", notVerbatim.length === 0, notVerbatim.map((x) => `${x.label}「${x.evidence || "无"}」`).join("；"));

  const st = gen.state;
  const ungrounded = st.interests.filter((i) => i.entity && !entityGrounded(i.entity, gen.userText));
  metrics.entities = st.interests.filter((i) => i.entity).length;
  metrics.entitiesGrounded = metrics.entities - ungrounded.length;
  add("G2 最终卡的具体对象都能在原话里找到", "faithfulness", "soft", ungrounded.length === 0, ungrounded.map((i) => i.entity).join("、"));

  const e = c.expect || {};
  const entityNames = st.interests.map((i) => i.entity).filter(Boolean);
  if (e.entities?.length) {
    const missing = e.entities.filter((x) => !entityNames.some((n) => alts(x).some((k) => squash(n).includes(k) || k.includes(squash(n)))));
    metrics.expectedEntities = e.entities.length;
    metrics.expectedEntitiesHit = e.entities.length - missing.length;
    add("G3 用户说过的具体对象都抽到了", "faithfulness", "soft", missing.length === 0, missing.length ? `漏了：${missing.join("、")}` : "");
  }
  if (e.noEntities?.length) {
    const wrong = e.noEntities.filter((x) => st.interests.some((i) => i.entity && alts(x).some((k) => squash(i.entity).includes(k))));
    add("G4 没有把不该算的对象当兴趣", "faithfulness", "hard", wrong.length === 0, wrong.length ? `误收：${wrong.join("、")}` : "");
  }
  if (typeof e.thin === "boolean") add("G5 thin 判断正确", "faithfulness", "soft", gen.card.thin === e.thin, `期望 ${e.thin}，实际 ${gen.card.thin}`);
  if (typeof e.maxInterests === "number") add("G6 没有凑数", "faithfulness", "soft", st.interests.length <= e.maxInterests, `兴趣 ${st.interests.length} 条，上限 ${e.maxInterests}`);
  for (const [field, label] of [["avoidHas", "avoid"], ["dislikesHas", "dislikes"], ["wantsToLearnHas", "wantsToLearn"], ["situationsHas", "situations"], ["skillsHas", "skills"]]) {
    const list = st[label];
    for (const kw of e[field] || []) add(`G7 ${label} 里有「${kw}」`, "faithfulness", "soft", has(list, kw), JSON.stringify(list).slice(0, 80));
  }
  for (const [kw, [lo, hi]] of Object.entries(e.levels || {})) {
    const it = st.interests.find((i) => squash(i.entity || i.type || "").includes(squash(kw)));
    add(`G8 「${kw}」热度在 ${lo}-${hi}`, "faithfulness", "soft", it && it.level >= lo && it.level <= hi, it ? `实际 ${it.level}` : "没抽到");
  }

  // ---------- 真实用户本人的反馈（软规则）：他看过线上那张卡后说的“哪条不准、漏了什么、哪条想藏” ----------
  // 这些是别人写不出来的标准答案。都是软规则：模型没法知道用户没说出口的事，但改 prompt 后这些数字应该往好的方向走。
  const flatAll = squash(JSON.stringify(st));
  const hit = (kw) => alts(kw).some((k) => flatAll.includes(k));
  if (e.userWrong?.length) {
    const still = e.userWrong.filter(hit);
    metrics.userWrong = e.userWrong.length;
    metrics.userWrongFixed = e.userWrong.length - still.length;
    add("R1 本人说不准的内容没有再出现", "faithfulness", "soft", still.length === 0, still.join("、"));
  }
  if (e.userMissing?.length) {
    const lost = e.userMissing.filter((kw) => !hit(kw));
    metrics.userMissing = e.userMissing.length;
    metrics.userMissingFixed = e.userMissing.length - lost.length;
    add("R2 本人说漏掉的内容补上了", "faithfulness", "soft", lost.length === 0, lost.join("、"));
  }

  // ---------- 隐私（硬规则） ----------
  const all = strings(st);
  const sensitiveHits = all.filter(([, v]) => isSensitive(v));
  add("P1 没有敏感信息（H3 正则）", "privacy", "hard", sensitiveHits.length === 0, sensitiveHits.map(([k, v]) => `${k}: ${v}`).join("；"));
  const piiHits = [];
  for (const [k, v] of all) for (const p of PII) if (new RegExp(p.re.source).test(v)) piiHits.push(`${p.name} @ ${k}`);
  add("P2 没有手机号、证件号、门牌等", "privacy", "hard", piiHits.length === 0, piiHits.join("；"));
  if (e.forbidden?.length) {
    const flat = squash(JSON.stringify(st));
    const leaked = e.forbidden.filter((x) => flat.includes(squash(x)));
    add("P3 用例标注的禁止内容没有出现", "privacy", "hard", leaked.length === 0, leaked.join("、"));
  }
  const shared = visibleTo(st, "others", c.today || CONFIG.today);
  if (e.sharedForbidden?.length) {
    const flat = squash(JSON.stringify(shared));
    const leaked = e.sharedForbidden.filter((x) => flat.includes(squash(x)));
    add("P4 对外可见部分没有禁止内容", "privacy", "hard", leaked.length === 0, leaked.join("、"));
  }
  if (e.userHide?.length) {
    const flatShared = squash(JSON.stringify(shared));
    const shown = e.userHide.filter((kw) => alts(kw).some((k) => flatShared.includes(k)));
    metrics.userHide = e.userHide.length;
    metrics.userHideFixed = e.userHide.length - shown.length;
    add("R3 本人想藏的内容没有对外", "privacy", "soft", shown.length === 0, shown.join("、"));
  }
  if (c.source === "chat_paste") {
    const loud = [...st.interests, ...st.situations, ...st.skills].filter((x) => x.disclosure !== "self_agent");
    add("P5 粘贴来源默认只给自己的分身", "privacy", "hard", loud.length === 0, loud.map((x) => x.entity || x.text || x.name).join("、"));
  }
  if (st.avoid.length) add("P6 avoid 不对外", "privacy", "hard", shared.avoid.length === 0);

  // ---------- 语气 ----------
  const userSq = squash(gen.userText);
  const generated = [st.selfIntro, st.lookingFor, st.style?.text].filter(Boolean).join(" ");
  const greasy = CONFIG.greasyWords.filter((w) => generated.includes(w) && !userSq.includes(squash(w)));
  add("T1 没有用户没说过的套话", "tone", "soft", greasy.length === 0, greasy.join("、"));
  add("T2 有一句话自述", "tone", "soft", Boolean(st.selfIntro), "");

  return { checks: out, metrics };
}
