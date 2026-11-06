// 小区试点的业务逻辑：当前用户、对外展示的卡片、每周配对的选人规则、配对页的数据。
// 接口层（app/api/community/*）和开奖脚本（scripts/run-round.mjs）共用。

import { SESSION_COOKIE, readSessionToken } from "./auth.mjs";
import { visibleTo, categoryName } from "./socialState.mjs";
import { normalizePersona, interestOverlap } from "./persona.mjs";

/** 从请求的 cookie 里取当前用户；没登录或用户已注销返回 null。 */
export async function currentUser(request, db) {
  if (!db) return null;
  const userId = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return db.users.byId(userId);
}

export const publicUser = (u) => (u ? { id: u.id, nickname: u.nickname, wechat: u.wechat || "" } : null);

/** 一张卡能给配对对象看的部分：只含公开和匹配可见的条目。 */
export function cardForOthers(card) {
  if (!card?.state) {
    return { selfIntro: card?.summary || "", lookingFor: card?.lookingFor || "", tier: card?.tier || "full", interests: (card?.interests || []).map((i) => ({ label: i.name })), situations: [], skills: [] };
  }
  const v = visibleTo(card.state, "others");
  return {
    tier: card.tier || "full",
    selfIntro: v.selfIntro,
    lookingFor: v.lookingFor,
    interests: v.interests.map((i) => ({ label: i.entity || i.type || categoryName(i.category), evidence: i.source === "quick" ? null : i.evidence })),
    situations: v.situations.map((s) => ({ label: s.text })),
    skills: v.skills.map((s) => ({ label: s.name })),
  };
}

/** 数据库里的卡转成配对用的人格卡，名字用昵称。 */
export function personaFromRow(row, user) {
  return normalizePersona({ ...row.card, name: user.nickname }, { id: user.id, name: user.nickname, source: row.card?.source || "chat" });
}

/** 能进配对池的卡：完整卡要已确认；速通卡生成即确认。 */
export const eligible = (row) => Boolean(row?.card) && (row.tier === "quick" || Boolean(row.confirmed_at));

/** 大类重合度：具体对象都对不上时，同为“音乐”“运动”的组合排在前面。 */
function categoryOverlap(a, b) {
  const cats = (p) => new Set((p.state ? visibleTo(p.state, "others").interests : []).map((i) => i.category));
  const A = cats(a);
  const B = cats(b);
  if (!A.size || !B.size) return 0;
  const shared = [...A].filter((c) => B.has(c)).length;
  return shared / (A.size + B.size - shared);
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * 每周开奖选人：兴趣重合粗筛 + 贪心分配。
 * - 每人最多 perUser 个配对
 * - 以前配过的、举报或拉黑过的不再配
 * - 有共同兴趣的组合优先；同样有（或同样没有）共同兴趣时，完整卡的组合优先，再看重合分和大类重合
 * @param {{userId:string, persona:object}[]} people
 * @param {{perUser?:number, seen?:Set<string>, blocked?:Set<string>}} opts
 */
export function planPairs(people, { perUser = 2, seen = new Set(), blocked = new Set() } = {}) {
  const candidates = [];
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const a = people[i];
      const b = people[j];
      const key = pairKey(a.userId, b.userId);
      if (seen.has(key) || blocked.has(key)) continue;
      const quick = (a.persona.tier === "quick" ? 1 : 0) + (b.persona.tier === "quick" ? 1 : 0);
      const minLevel = quick ? 6 : 7;
      const overlap = interestOverlap(a.persona, b.persona, { minLevel });
      candidates.push({ a, b, quick, overlap, cat: categoryOverlap(a.persona, b.persona) });
    }
  }
  const hasShared = (c) => (c.overlap.score > 0 ? 1 : 0);
  candidates.sort((x, y) => hasShared(y) - hasShared(x) || x.quick - y.quick || y.overlap.score - x.overlap.score || y.cat - x.cat || pairKey(x.a.userId, x.b.userId).localeCompare(pairKey(y.a.userId, y.b.userId)));
  const count = new Map();
  const picked = [];
  for (const c of candidates) {
    const na = count.get(c.a.userId) || 0;
    const nb = count.get(c.b.userId) || 0;
    if (na >= perUser || nb >= perUser) continue;
    count.set(c.a.userId, na + 1);
    count.set(c.b.userId, nb + 1);
    picked.push(c);
  }
  return picked;
}

export { pairKey };

/** 从配对记录和举报记录里算出“以前配过”和“拉黑过”的组合。 */
export function history(matches, reports) {
  const seen = new Set(matches.map((m) => pairKey(m.a_id, m.b_id)));
  const blocked = new Set(reports.map((r) => pairKey(r.reporter_id, r.target_id)));
  return { seen, blocked };
}

/** 配对页给某一方看的数据。对方的微信号只在双方都点了“想认识”之后给。 */
export function matchView(match, me, other, otherCard) {
  const iAmA = match.a_id === me.id;
  const myChoice = iAmA ? match.a_choice : match.b_choice;
  const theirChoice = iAmA ? match.b_choice : match.a_choice;
  const mutual = myChoice === "like" && theirChoice === "like";
  const judge = match.judge || {};
  return {
    id: match.id,
    other: { nickname: other?.nickname || "已注销的邻居", card: otherCard ? cardForOthers(otherCard) : null, wechat: mutual ? other?.wechat || "" : null },
    iAmA,
    shared: match.shared || [],
    transcript: (match.transcript || []).map((m) => ({ mine: (m.speaker === "A") === iAmA, text: m.text })),
    reasons: judge.reasons || [],
    icebreakers: iAmA ? judge.icebreakers || [] : [],
    myChoice: myChoice || null,
    // 对方的选择只在双向时透露，避免单向“被拒”的感受
    mutual,
  };
}
