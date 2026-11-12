import { NextResponse } from "next/server";
import { createLLM, getLLMConfig } from "@/lib/llm.mjs";
import { extractPersona, extractState } from "@/lib/agents.mjs";
import { prepareChatForLLM, redact } from "@/lib/privacy.mjs";
import { normalizePersona } from "@/lib/persona.mjs";
import { validateState, buildCard, mergeStates, todayISO, CARD_VERSION } from "@/lib/socialState.mjs";
import { enrichCard } from "@/lib/gaps.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }
  const { chatText = "", nickname = "", consent, adult, mode } = body || {};
  if (!consent || !adult) {
    return NextResponse.json({ error: "需要确认已年满 18 岁并同意分析说明" }, { status: 400 });
  }
  if (mode === "guided") return guided(body);
  if (mode === "paste") return paste(body);
  if (mode === "more") return more(body);
  if (mode === "gap") return gap(body);
  if (String(chatText).trim().length < 20) {
    return NextResponse.json({ error: "聊天内容太少了，至少粘贴几句你自己发过的话" }, { status: 400 });
  }

  // 原始聊天只在内存里处理：先过滤他人消息、再脱敏，之后才发给模型；不落盘、不打日志
  const prepared = prepareChatForLLM(chatText, [String(nickname).trim()]);
  if (!prepared.report.keptCount) {
    return NextResponse.json(
      { error: "没有识别到你本人发的消息。请用“我：内容”的格式，或在昵称里填你在聊天记录里的名字。" },
      { status: 400 }
    );
  }

  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { persona } = await extractPersona(llm, prepared.text, { nickname: String(nickname).trim() || undefined });
    return NextResponse.json({ persona, privacy: prepared.report, mode: llm.isMock ? "demo" : "live" });
  } catch (error) {
    console.error("persona error:", error.message);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}

// ---------- 人格卡 v2 ----------

const WITH_TRAITS_MIN = 20; // 本人消息少于 20 条时只抽兴趣和近况，不给特质打分（SKILL.md 第 2 步）

/** 三问引导的回答 → v2 完整卡（未确认）。 */
async function guided(body) {
  const answers = Array.isArray(body.answers) ? body.answers : [];
  // 只有用户自己说的话进入模型和证据核对；问题本身不算
  const lines = answers
    .flatMap((a) => [a?.answer, a?.followupAnswer])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => t.slice(0, 300));
  if (!lines.length) {
    return NextResponse.json({ error: "还没有回答任何问题" }, { status: 400 });
  }
  const userText = redact(lines.join("\n")).text;
  const today = todayISO();
  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { raw } = await extractState(llm, userText, { source: "guided", today });
    const { state, dropped } = validateState(raw, { userText, source: "guided", today });
    const persona = buildCard({ state, tier: "full", source: "guided", name: String(body.nickname || "").trim().slice(0, 20) || "我的claw", today });
    return NextResponse.json({ persona, dropped, mode: llm.isMock ? "demo" : "live" });
  } catch (error) {
    console.error("persona guided error:", error.message);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}

/** 确认页“信息还有点少”时补的一句话 → 并进已有的卡。和三问一样按用户自己说的话抽取，可见范围用三问的默认值。 */
async function more(body) {
  const base = body.persona;
  if (base?.cardVersion !== CARD_VERSION || !base.state) {
    return NextResponse.json({ error: "缺少要补充的人格卡" }, { status: 400 });
  }
  const text = String(body.text || "").trim().slice(0, 200);
  if (text.length < 2) return NextResponse.json({ error: "多写几个字吧，比如一部剧、一款游戏的名字" }, { status: 400 });
  const userText = redact(text).text;
  const today = todayISO();
  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { raw } = await extractState(llm, userText, { source: "guided", today });
    const { state: incoming } = validateState(raw, { userText, source: "guided", today });
    const { state, added } = mergeStates(base.state, incoming, { review: false });
    const persona = buildCard({ ...base, state, confirmedAt: null, today });
    return NextResponse.json({ persona, added, mode: llm.isMock ? "demo" : "live" });
  } catch (error) {
    console.error("persona more error:", error.message);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}

/** 已有的卡 + 粘贴的聊天记录 → 合并后的卡。新条目一律“仅自己的分身”，等用户在确认页决定。 */
async function paste(body) {
  const base = body.persona;
  if (base?.cardVersion !== CARD_VERSION || !base.state) {
    return NextResponse.json({ error: "缺少要补充的人格卡" }, { status: 400 });
  }
  const chatText = String(body.chatText || "");
  if (chatText.trim().length < 20) {
    return NextResponse.json({ error: "聊天内容太少了，至少粘贴几句你自己发过的话" }, { status: 400 });
  }
  const prepared = prepareChatForLLM(chatText, [String(body.nickname || "").trim()]);
  if (!prepared.report.keptCount) {
    return NextResponse.json(
      { error: "没有识别到你本人发的消息。请用“我：内容”的格式，或在昵称里填你在聊天记录里的名字。" },
      { status: 400 }
    );
  }
  const today = todayISO();
  const withTraits = prepared.report.keptCount >= WITH_TRAITS_MIN;
  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { raw } = await extractState(llm, prepared.text, { source: "chat_paste", today, withTraits });
    const { state: incoming, dropped } = validateState(raw, { userText: prepared.text, source: "chat_paste", today });
    if (!withTraits) incoming.style = null; // 消息太少，不推说话风格
    const { state, added } = mergeStates(base.state, incoming);
    const traits = withTraits ? normalizePersona({ traits: raw?.traits }).traits : base.traits;
    const persona = buildCard({ ...base, state, traits, confirmedAt: null, today });
    return NextResponse.json({ persona, added, dropped, privacy: { ...prepared.report, fewMessages: !withTraits }, mode: llm.isMock ? "demo" : "live" });
  } catch (error) {
    console.error("persona paste error:", error.message);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}

/** 单人体验：分身在代聊里答不上来的问题，本人补一句 → 并进卡。卡已经确认过，补完不用重新确认。 */
async function gap(body) {
  const base = body.persona;
  if (base?.cardVersion !== CARD_VERSION || !base.state) {
    return NextResponse.json({ error: "缺少要补充的人格卡" }, { status: 400 });
  }
  const text = String(body.text || "").trim();
  if (text.length < 2) return NextResponse.json({ error: "多写几个字吧" }, { status: 400 });
  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { card, added } = await enrichCard(llm, base, { question: String(body.question || ""), answer: text });
    return NextResponse.json({ persona: card, added, mode: llm.isMock ? "demo" : "live" });
  } catch (error) {
    console.error("persona gap error:", error.message);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}
