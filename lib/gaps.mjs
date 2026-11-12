// 从代聊反哺人格卡：找出分身答不上来的地方，变成问本人的一句话；本人补的话再并回人格卡。
// 规则来源：skills/icebreak-topics/SKILL.md「从代聊补卡」。改规则时两边一起改。

import { renderPersona } from "./persona.mjs";
import { extractState } from "./agents.mjs";
import { redact } from "./privacy.mjs";
import { validateState, mergeStates, buildCard, categoryName, todayISO } from "./socialState.mjs";

export const MAX_GAPS = 2;

// 分身按 H8 规则答不上来时会说的话
const STUCK = /不太了解|不太懂|没怎么(接触|玩|看|听|试|碰)|没(玩|听|看|试)过|不清楚|不知道/;

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * 不调模型的版本：在 role 这一方说“不太了解/没怎么接触过”的地方，取对方上一句当作问住它的话。
 * 旧轮次（没存 gaps）和模型出错时用它兜底。
 */
export function gapsFromTranscript(transcript, role) {
  const out = [];
  const seen = new Set();
  (transcript || []).forEach((m, i) => {
    if (m.speaker !== role || !STUCK.test(m.text) || i === 0) return;
    const prev = transcript[i - 1];
    if (!prev || prev.speaker === role) return;
    const quote = clip(prev.text, 60);
    if (seen.has(quote)) return;
    seen.add(quote);
    out.push({ quote, ask: "对方聊到这个，你的分身没接上。换你自己，会怎么回？" });
  });
  return out.slice(0, MAX_GAPS);
}

function cleanGaps(list, transcript, role) {
  const theirLines = (transcript || []).filter((m) => m.speaker !== role).map((m) => m.text);
  return (Array.isArray(list) ? list : [])
    .map((g) => ({ quote: clip(g?.quote, 60), ask: clip(g?.ask, 40) }))
    // 引用必须真是对方分身说过的话，防止模型编
    .filter((g) => g.quote && g.ask && theirLines.some((t) => t.includes(g.quote) || g.quote.includes(clip(t, 60))))
    .slice(0, MAX_GAPS);
}

/**
 * 读一段代聊，分别找出 A、B 的分身因为档案里没有而答不上、答得含糊的地方。
 * 返回 {A: [{quote, ask}], B: [...]}；quote 是对方分身的原话，ask 是问本人的一句话。
 */
export async function findGaps(llm, a, b, transcript) {
  const fallback = { A: gapsFromTranscript(transcript, "A"), B: gapsFromTranscript(transcript, "B") };
  if (!Array.isArray(transcript) || !transcript.length) return { gaps: { A: [], B: [] }, usage: {} };
  const lines = transcript.map((m) => `${m.speaker}：${m.text}`).join("\n");
  const system = `你在帮两个用户完善各自的 AI 分身。下面是两个分身替主人聊天的记录，分身只能说主人档案里有的东西。
请分别找出 A、B 的分身因为档案里没有相关信息而答不上来、只能说“不太了解”、或者答得很含糊的地方。
每一方最多 ${MAX_GAPS} 条，挑对认识新朋友最有用的（具体的兴趣、想一起做什么、什么时候有空），没有就给空数组。

每条给：
- quote：对方分身问住它的那句话，从记录里原样复制，不超过 40 字
- ask：直接问主人本人的一句话，用“你”称呼，像朋友随口问，不超过 30 字，问出具体的东西（比如“你玩过三角洲吗？平时更爱玩哪类游戏？”）

不要问：主人档案里“不想聊的话题”、性别、年龄、学校、住址、收入、健康、感情状况、联系方式。

【A 的档案】
${renderPersona(a)}

【B 的档案】
${renderPersona(b)}

只输出 JSON：{"A": [{"quote": "...", "ask": "..."}], "B": [...]}`;
  try {
    const res = await llm.chat({
      tag: "find_gaps",
      json: true,
      temperature: 0.2,
      maxTokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `代聊记录：\n${lines}` },
      ],
      mockContext: { transcript },
    });
    const gaps = { A: cleanGaps(res.json?.A, transcript, "A"), B: cleanGaps(res.json?.B, transcript, "B") };
    // 模型一条都没给、但分身明明说了“不太了解”时，用规则版补上
    for (const side of ["A", "B"]) if (!gaps[side].length) gaps[side] = fallback[side];
    return { gaps, usage: res.usage };
  } catch {
    return { gaps: fallback, usage: {} };
  }
}

/** 演示模式用的假输出：就是规则版的结果。 */
export function mockGaps({ transcript }) {
  return JSON.stringify({ A: gapsFromTranscript(transcript, "A"), B: gapsFromTranscript(transcript, "B") });
}

const itemLabel = (i) => i.entity || i.type || categoryName(i.category);

/**
 * 本人回答一个“答不上来”的问题（或随手补一句）→ 并进已有的人格卡。
 * 只按本人的回答抽取和核对证据，问题本身不算原话。新条目用三问的默认可见范围（匹配可见）。
 * 返回新卡和新加了哪些东西（给前端展示，也用来判断是不是什么都没加）。
 */
export async function enrichCard(llm, card, { question = "", answer = "", today = todayISO() } = {}) {
  const userText = redact(clip(answer, 200)).text;
  const { raw } = await extractState(llm, userText, { source: "guided", today, context: clip(question, 60) });
  const { state: incoming } = validateState(raw, { userText, source: "guided", today });
  const { state } = mergeStates(card.state, incoming, { review: false });
  const before = card.state || {};
  const added = [];
  const has = (list, x) => (list || []).includes(x);
  for (const i of state.interests.slice((before.interests || []).length)) added.push(itemLabel(i));
  for (const s of state.situations.slice((before.situations || []).length)) added.push(`近况：${s.text}`);
  for (const s of state.skills.slice((before.skills || []).length)) added.push(`会：${s.name}`);
  for (const w of state.wantsToLearn || []) if (!has(before.wantsToLearn, w)) added.push(`想学：${w}`);
  // 想认识的人：原来是空的或只是按钮上的字，用新说的补全；不覆盖原话
  const lf = clip(incoming.lookingFor, 60);
  if (lf && !String(before.lookingFor || "").includes(lf)) {
    state.lookingFor = before.lookingFor ? clip(`${before.lookingFor}；${lf}`, 60) : lf;
    added.push(`想认识：${lf}`);
  }
  // 补卡不改说话风格：一两句回答看不出风格
  state.style = before.style || null;
  const next = buildCard({ ...card, state, today });
  return { card: next, added };
}
