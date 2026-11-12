// SocialQ 的 AI 闭环：人格提炼 -> Agent 代聊 -> 匹配判断。
// App（交友场景）和 Speed Dating 验证实验（快速约会场景）调用的是同一组函数，
// 只通过 scenario 切换活动背景，保证“实验验证的”就是“产品上线的”那套逻辑。

import { normalizePersona, renderPersona, clampScore, TRAIT_LABELS } from "./persona.mjs";
import { CATEGORIES } from "./socialState.mjs";

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

// 速通卡只知道兴趣大类：分身用中性语气，多问少说，不替主人表态
const QUICK_RULES = `速通卡规则（你的主人只点选了兴趣大类）：
- 用中性、友好的语气，不模仿任何特定的说话风格。
- 多提问、少讲自己；讲到自己时只说到大类（“我主人平时也玩游戏”），不说具体作品或人名。
- 不要说“我也超爱”“我主人最喜欢”这类笃定的话。
`;

// 替主人说话：补全表意，不扩展内容。规则来源：skills/icebreak-topics/SKILL.md「替主人说话」和 rules.json H8，改的时候两边一起改。
const GROUNDING_RULES = `可以把档案里的短句说完整、说顺口，但不能往里加东西：
   - 不加对象：档案没写的歌手、游戏、剧、作品，不要说自己喜欢或知道。
   - 不加经历和能力：对方提到档案里没有的东西，不能说“我也玩过”“我也会”。
   - 不加程度：“在听歌”不能说成“单曲循环”“天天听”。
   - “想认识的人”是主人想找什么样的人，不是主人自己的兴趣：“想找能一起玩的搭子”只能说成想找人一起玩，不能说成主人会玩什么。
   - 对方问到档案里没有的，照实说“这个不太了解”“没怎么接触过”，再反问对方。宁可聊冷一点，也不要编。
   - 也不要替主人否认：档案没写的，只说“不太了解”，不要说成“不喜欢”“不怎么看”“没怎么听”。
   - 用第一人称说话，不要自称“某某的分身”。
`;

function agentSystemPrompt(self, scenario, isLast) {
  const s = SCENARIOS[scenario];
  return `你是「${self.name}」的 AI 分身（claw），正在替主人参加：${s.event}。你正在和对方的分身聊天。

【主人档案】
${renderPersona(self)}

聊天规则：
1. 用第一人称、按主人的性格和说话风格聊天，口语化，每次只发一条消息，不超过 60 个字。
2. 说到主人自己时，只能说档案里有的。${GROUNDING_RULES}
3. 目标是真实地判断两人合不合得来，而不是一味讨好；对不感兴趣的话题可以诚实表达。
4. 不透露联系方式、住址、学校名称等隐私信息。
${self.tier === "quick" ? QUICK_RULES : ""}${isLast ? "5. 这是你在这段对话里的最后一条消息，可以自然地收尾。\n" : ""}只输出消息正文，不要加引号或说明。`;
}

export async function runAgentChat(llm, a, b, { scenario = "friendship", turns = 6, temperature = 0.6 } = {}) {
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

你只能通过下面这段对话了解对方。分身在对话里说的话可能有和档案对不上的地方：你主人的情况以上面的档案为准，档案里没有的（比如对话里说“我也玩过”）不能当成你们的共同点。请站在主人的角度判断：如果是主人本人和对方聊了这些，${s.decision}？
只输出 JSON：{"probability": 0-100 的整数, "reason": "一句话理由"}`;
  const res = await llm.chat({
    tag: "self_assess",
    json: true,
    temperature: 0,
    maxTokens: 400, // 中文理由 + JSON 外壳，200 会被截断
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
${withChat ? "你会看到双方档案，以及双方 AI 分身之间的一段代聊记录（分身按主人档案扮演，不是真人本人）。分身说的话和档案对不上、或在档案里找不到依据的（比如档案没提游戏，分身却说“我也玩过”），以档案为准，不能据此加分，可以写进 risks。" : "你只能看到双方档案。"}
只输出 JSON：{"a_wants_b": 整数, "b_wants_a": 整数, "reasons": ["最多 3 条匹配或不匹配的理由"], "risks": ["最多 2 条可能聊不来的点"], "icebreakers": ["2 条 A 以真人身份给 B 的开场白，自然、具体、不油腻"]}`;
  // 裁判不是任何一方自己的分身，只能看对外可见的内容（披露级别 public / match）
  const user = `【A 的档案】\n${renderPersona(a, { audience: "others" })}\n\n【B 的档案】\n${renderPersona(b, { audience: "others" })}${
    withChat ? `\n\n【代聊记录】\n${formatTranscript(transcript, a, b)}` : ""
  }`;
  const res = await llm.chat({
    tag: withChat ? "judge_chat" : "judge_direct",
    json: true,
    temperature: 0,
    maxTokens: 1000, // 理由、风险、两条开场白都是中文，600 偶尔不够
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

// ---------- 4. 人格卡 v2：三问引导的追问判断、抽取社交状态 ----------
// 规则来源：skills/persona-card/SKILL.md 和 questions.md。改规则时两边一起改。

export const GUIDED_QUESTIONS = [
  {
    id: 1,
    text: "最近在循环、在追或者在玩什么？随便说一两个就行",
    chips: ["在听歌", "在追剧/看番", "在打游戏", "在运动"],
    goal: "拿到至少 2 个具体对象（具体的歌手、乐队、剧、番、游戏、球队等）。只说了大类或类型就追问一个具体的；已经说到具体对象就追问是最近入坑还是老粉；已经有 2 个以上具体对象就不追问。",
  },
  {
    id: 2,
    text: "最近在忙什么，或者有什么想学、想试的？",
    chips: ["在备考", "刚换工作/实习", "想学一门手艺", "没啥特别的"],
    goal: "拿到近况和想学的。说了有期限的事（备考、旅行）就追问大概什么时候；说了想学的东西就追问有没有基础；说没啥特别的就不追问。",
  },
  {
    id: 3,
    text: "想认识什么样的人？有没有不太想被聊到的话题？",
    chips: ["能一起玩的搭子", "聊得来的朋友", "同行交流", "都行"],
    goal: "拿到想认识什么样的人，以及不想被聊到的话题。只回答了一半就补问另一半（“有不想被问到的话题吗？没有就算了”）；两半都答了就不追问。",
  },
];

const SKIP = /^(跳过|不知道|没有|没|算了|随便|都行|skip)[。.!！~～]*$/i;

/** 判断要不要追问。每题最多追问一次；用户说跳过或已经追问过时不调用模型。 */
export async function decideFollowup(llm, { question, answer, askedFollowup = false }) {
  const q = GUIDED_QUESTIONS.find((x) => x.id === Number(question));
  const text = String(answer || "").trim();
  if (!q || askedFollowup || !text || SKIP.test(text)) return { action: "next", text: "" };
  const system = `你在帮 SocialQ 的新用户建分身，用聊天的方式问了一个问题。现在判断要不要追问一句。
问题：${q.text}
这一题的目标：${q.goal}
要求：
- 追问像朋友随口问，不超过 30 个字，不复述用户的话，不夸奖。
- 不问城市、学校、年龄、MBTI 等个人信息。
- 不要出现“人格卡”“标签”“数据”这些词。
只输出 JSON：{"action": "followup" 或 "next", "text": "追问的话，action 为 next 时留空"}`;
  const res = await llm.chat({
    tag: "persona_followup",
    json: true,
    temperature: 0.3,
    maxTokens: 120,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `用户的回答：${text}` },
    ],
    mockContext: { question: q.id, answer: text },
  });
  const action = res.json?.action === "followup" && res.json?.text ? "followup" : "next";
  return { action, text: action === "followup" ? String(res.json.text).slice(0, 40) : "", usage: res.usage };
}

const TAXONOMY_TEXT = CATEGORIES.map((c) => `${c.id}（${c.name}）：${c.types.join("、")}`).join("\n");

/**
 * 从用户原话里抽取社交状态（未校验，交给 lib/socialState.mjs 的 validateState）。
 * @param {"guided"|"chat_paste"} source
 * @param {boolean} withTraits  粘贴记录里本人消息够多时，顺带给 6 项特质打分
 */
export async function extractState(llm, userText, { source = "guided", today, withTraits = false } = {}) {
  const system = `你是 SocialQ 的人格卡助手。输入是用户本人${source === "guided" ? "在引导对话里的回答" : "在聊天里发出的消息（已脱敏）"}。今天是 ${today}。
请抽取一份结构化的社交状态，供用户的 AI 分身和别人交流时使用。

规则：
1. 只记用户明确说过的东西，不推断没说的兴趣（“喜欢周杰伦”不能推出“喜欢华语流行”再加一条）。
2. 每条兴趣、近况、技能都要有 evidence：从输入里原样复制的一段原话，不超过 20 字，不改写、不拼接。
3. 兴趣拆成三级：category 和 type 只能从下面的列表里选，对不上就把 type 设为 null；entity 是用户说出的具体对象（歌手、乐队、剧、游戏、球队、书……），没说具体对象就设为 null。
4. 热度 level（1-10）：“单曲循环”“每天都玩”“老粉了”记 8-9；“在追”“最近挺喜欢”记 7；“还行”“偶尔”记 5；“听说过”“想试试”不算兴趣，放进 wantsToLearn 或丢掉。拿不准给 6。
5. 用户说了“最近”“这周”“在追”时，recentAt 填今天，否则填 null。
6. situations 只记粗粒度描述（“在备考”“刚开始实习”），给了时间点就填 expiresAt（YYYY-MM-DD），没给填 null。
7. skills 是有基础的（role 为 expert 或 intermediate），wantsToLearn 是想学但没基础的。
8. avoid 是不想被聊到的话题，dislikes 是讨厌但可以吐槽的东西，不要混。
9. 不写、不推断性别、年龄、民族、宗教、政治、健康、性取向、学校、住址。
10. style 根据用户说话的方式（句子长短、语气词、表情、是否爱用梗）写一句话，并给 1-2 条口头禅原话。

兴趣分类（category id（中文名）：可选的 type）：
${TAXONOMY_TEXT}

只输出 JSON：
{"selfIntro": "不超过 40 字，用用户自己的词", "lookingFor": "想认识什么样的人，没说就空字符串",
 "interests": [{"category": "music", "type": "独立音乐", "entity": "草东没有派对", "level": 8, "recentAt": "${today}", "evidence": "原话"}],
 "situations": [{"text": "在备考", "expiresAt": null, "evidence": "原话"}],
 "skills": [{"name": "吉他", "role": "intermediate", "evidence": "原话"}],
 "wantsToLearn": [], "dislikes": [], "avoid": [],
 "style": {"text": "一句话", "catchphrases": ["原话"], "confidence": 0.3}${
   withTraits ? `,
 "traits": [{"label": "${TRAIT_LABELS[0]}", "score": 0-100 的整数, "evidence": "原话或“证据不足”"}]（traits 必须恰好包含：${TRAIT_LABELS.join("、")}）` : ""
 }}`;
  const res = await llm.chat({
    tag: "persona_state",
    json: true,
    temperature: 0.2,
    maxTokens: 1400,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
    mockContext: { userText, source, today, withTraits },
  });
  return { raw: res.json, usage: res.usage };
}
