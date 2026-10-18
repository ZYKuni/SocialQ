// SocialQ 的 AI 闭环：人格提炼 -> Agent 代聊 -> 匹配判断。
// App（交友场景）和 Speed Dating 验证实验（快速约会场景）调用的是同一组函数，
// 只通过 scenario 切换活动背景，保证“实验验证的”就是“产品上线的”那套逻辑。

import { normalizePersona, renderPersona, clampScore, TRAIT_LABELS } from "./persona.mjs";

export const SCENARIOS = {
  speed_dating: {
    event: "一场异性快速约会活动（speed dating），每对只有 4 分钟",
    decision: "活动结束后，是否愿意和对方再次见面",
  },
  friendship: {
    event: "QQ 上的新朋友匹配：双方的 AI 分身先替主人聊几句，合适再由真人接管",
    decision: "是否愿意加对方为好友、继续聊下去",
  },
};

// 验证实验显示：见面前的信息只能弱预测两人是否合得来，所以对外只给分档，不给“契合度 92%”这种精确数字
export function tierOf(score) {
  if (score >= 45) return { key: "high", label: "很可能聊得来" };
  if (score >= 25) return { key: "mid", label: "值得一试" };
  return { key: "low", label: "可能不太来电" };
}

const sum = (a, b) => ({
  promptTokens: (a?.promptTokens || 0) + (b?.promptTokens || 0),
  completionTokens: (a?.completionTokens || 0) + (b?.completionTokens || 0),
});

function formatTranscript(transcript, a, b) {
  return transcript.map((m) => `${m.speaker}（${m.speaker === "A" ? a.name : b.name}）：${m.text}`).join("\n");
}

// ---------- 1. 人格提炼（仅 App 使用） ----------

export async function extractPersona(llm, chatText, { nickname } = {}) {
  const system = `你是 SocialQ 的人格提炼助手。输入是用户【本人】在 QQ 上发出的消息（已脱敏，可能零散不完整）。
请根据这些消息提炼用户的社交人格卡，用于替 TA 结交新朋友。

要求：
- 只根据消息里的证据，不要编造经历。
- 不要推断或写出性别、年龄、民族、宗教、政治立场、健康状况、性取向、学校、住址等敏感信息。
- traits 必须恰好包含这 6 项：${TRAIT_LABELS.join("、")}；score 为 0-100 的整数；evidence 引用一句原话（不超过 20 字），没有证据就写"证据不足"并给 50 分左右。
- interests 最多 6 个短标签，level 为 1-10。

只输出 JSON，格式：
{"summary": "不超过 40 字的一句话画像", "interests": [{"name": "标签", "level": 8}], "style": "说话风格，一句话", "schedule": "作息，一句话或未知", "lookingFor": "想认识什么样的朋友，一句话（可根据兴趣推断，推断时加'可能'）", "avoid": ["从消息看可能不想聊的话题，可为空"], "traits": [{"label": "搞怪值", "score": 80, "evidence": "原话"}]}`;
  const res = await llm.chat({
    tag: "persona_extract",
    json: true,
    temperature: 0.2,
    maxTokens: 900,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `用户本人的消息如下：\n${chatText}` },
    ],
    mockContext: { chatText, nickname },
  });
  return { persona: normalizePersona(res.json, { name: nickname || "我的claw", source: "chat" }), usage: res.usage };
}

// ---------- 2. Agent 代聊 ----------

function agentSystemPrompt(self, scenario, isLast) {
  const s = SCENARIOS[scenario];
  return `你是「${self.name}」的 AI 分身（claw），正在替主人参加：${s.event}。你正在和对方的分身聊天。

【主人档案】
${renderPersona(self)}

聊天规则：
1. 用第一人称、按主人的性格和说话风格聊天，口语化，每次只发一条消息，不超过 60 个字。
2. 只能使用档案里的信息；档案没写的具体经历不要编造，可以提问、聊感受和偏好。
3. 目标是真实地判断两人合不合得来，而不是一味讨好；对不感兴趣的话题可以诚实表达。
4. 不透露联系方式、住址、学校名称等隐私信息。
${isLast ? "5. 这是你在这段对话里的最后一条消息，可以自然地收尾。\n" : ""}只输出消息正文，不要加引号或说明。`;
}

export async function runAgentChat(llm, a, b, { scenario = "friendship", turns = 6, temperature = 0.8 } = {}) {
  const transcript = [];
  let usage = {};
  for (let i = 0; i < turns; i += 1) {
    const speaker = i % 2 === 0 ? "A" : "B";
    const self = speaker === "A" ? a : b;
    const other = speaker === "A" ? b : a;
    const isLast = i >= turns - 2;
    const messages = [{ role: "system", content: agentSystemPrompt(self, scenario, isLast) }];
    if (speaker === "A") messages.push({ role: "user", content: "（活动开始了，请你先开场打招呼）" });
    for (const m of transcript) {
      messages.push({ role: m.speaker === speaker ? "assistant" : "user", content: m.text });
    }
    const res = await llm.chat({
      tag: "agent_turn",
      temperature,
      maxTokens: 150,
      messages,
      mockContext: { self, other, turn: i, transcript, scenario },
    });
    const text = String(res.content || "").trim().replace(/^["“]|["”]$/g, "").slice(0, 200);
    transcript.push({ speaker, text });
    usage = sum(usage, res.usage);
  }
  return { transcript, usage };
}

// ---------- 3a. 分身自评：只看自己的档案 + 对话 ----------

export async function selfAssess(llm, self, other, role, transcript, a, b, { scenario = "friendship" } = {}) {
  const s = SCENARIOS[scenario];
  const system = `你是「${self.name}」的 AI 分身，刚刚替主人参加了：${s.event}。

【主人档案】
${renderPersona(self)}

你只能通过下面这段对话了解对方。请站在主人的角度判断：如果是主人本人和对方聊了这些，${s.decision}？
只输出 JSON：{"probability": 0-100 的整数, "reason": "一句话理由"}`;
  const res = await llm.chat({
    tag: "self_assess",
    json: true,
    temperature: 0,
    maxTokens: 200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `对话记录（你是 ${role}）：\n${formatTranscript(transcript, a, b)}` },
    ],
    mockContext: { self, other, transcript, scenario },
  });
  return { probability: clampScore(res.json.probability), reason: String(res.json.reason || ""), usage: res.usage };
}

// ---------- 3b. 中立裁判：看双方档案（+ 可选对话） ----------

/**
 * transcript 为 null 时就是“只看档案”的直接判断（实验里的 L1 组）；
 * 传入对话时就是“档案 + 代聊”的裁判（实验里的 L2-judge 组，也是 App 实际用的匹配分）。
 * 两者 prompt 只差对话这一块，所以两组的差值就是“代聊带来的增量信息”。
 */
export async function judgePair(llm, a, b, { scenario = "friendship", transcript = null } = {}) {
  const s = SCENARIOS[scenario];
  const withChat = Array.isArray(transcript) && transcript.length > 0;
  const system = `你是一位谨慎的社交匹配分析师。场景：${s.event}。
请判断：A 和 B 各自${s.decision}？给出 0-100 的概率。注意大多数人不会对大多数人感兴趣，不要轻易给高分。
${withChat ? "你会看到双方档案，以及双方 AI 分身之间的一段代聊记录（分身按主人档案扮演，不是真人本人）。" : "你只能看到双方档案。"}
只输出 JSON：{"a_wants_b": 整数, "b_wants_a": 整数, "reasons": ["最多 3 条匹配或不匹配的理由"], "risks": ["最多 2 条可能聊不来的点"], "icebreakers": ["2 条 A 以真人身份给 B 的开场白，自然、具体、不油腻"]}`;
  const user = `【A 的档案】\n${renderPersona(a)}\n\n【B 的档案】\n${renderPersona(b)}${
    withChat ? `\n\n【代聊记录】\n${formatTranscript(transcript, a, b)}` : ""
  }`;
  const res = await llm.chat({
    tag: withChat ? "judge_chat" : "judge_direct",
    json: true,
    temperature: 0,
    maxTokens: 600,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    mockContext: { a, b, transcript, scenario },
  });
  const j = res.json;
  const aWantsB = clampScore(j.a_wants_b);
  const bWantsA = clampScore(j.b_wants_a);
  const list = (v, n) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, n) : []);
  return {
    aWantsB,
    bWantsA,
    mutual: Math.round((aWantsB * bWantsA) / 100),
    reasons: list(j.reasons, 3),
    risks: list(j.risks, 2),
    icebreakers: list(j.icebreakers, 2),
    usage: res.usage,
  };
}

/** 完整匹配流程：代聊 + 双方自评 + 裁判。App 的 /api/match 与实验的 L2 组共用。 */
export async function matchWithAgents(llm, a, b, { scenario = "friendship", turns = 6 } = {}) {
  const chat = await runAgentChat(llm, a, b, { scenario, turns });
  const [selfA, selfB, judge] = await Promise.all([
    selfAssess(llm, a, b, "A", chat.transcript, a, b, { scenario }),
    selfAssess(llm, b, a, "B", chat.transcript, a, b, { scenario }),
    judgePair(llm, a, b, { scenario, transcript: chat.transcript }),
  ]);
  const usage = [selfA.usage, selfB.usage, judge.usage].reduce(sum, chat.usage);
  return { transcript: chat.transcript, selfA, selfB, judge, usage };
}
