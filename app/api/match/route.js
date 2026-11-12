import { NextResponse } from "next/server";
import { createLLM, getLLMConfig } from "@/lib/llm.mjs";
import { matchWithAgents, tierOf } from "@/lib/agents.mjs";
import { normalizePersona, interestOverlap } from "@/lib/persona.mjs";
import { SAMPLE_POOL, publicProfile } from "@/lib/samplePool.mjs";

// 赛博酒会（单人体验）：和虚构示例用户的分身代聊。
// 分两步，前端能一个个显示进度，一个候选人卡住也不拖累别的：
//   POST {persona, step: "shortlist"}       → 兴趣粗筛，返回要聊的候选人（不调大模型）
//   POST {persona, candidateId}             → 只和这一位跑代聊和评估
// 不带 step 和 candidateId 时保持旧行为：一次聊完全部候选人。

export const runtime = "nodejs";
export const maxDuration = 300;

const SHORTLIST = 3;
// 网页请求里单次模型调用等不了太久：25 秒超时、最多重试 1 次，整轮在函数时限内一定能返回
const WEB_LLM = { timeoutMs: 25000, maxRetries: 1 };

function readMe(body) {
  if (!body?.persona) return { error: "缺少人格卡" };
  const me = normalizePersona(body.persona, { id: "me", name: body.persona.name || "我的claw", source: "chat" });
  if (me.cardVersion && !me.confirmedAt && me.tier !== "quick") return { error: "人格卡还没确认，先回去点“好了”" };
  return { me };
}

function rank(me) {
  const meTier = me.tier || "full";
  // 速通卡的兴趣热度都是 6，用默认的 7 做门槛会一个共同兴趣都算不出来
  const minLevel = meTier === "quick" ? 6 : 7;
  // 第一层：零成本的兴趣重合粗筛；第二层：只对前几名跑 Agent 代聊（成本高）
  // 完整卡的候选人排在速通卡前面，避免认真做卡的人一直碰到信息很少的分身
  const quickRank = (c) => (c.tier === "quick" ? 1 : 0);
  return SAMPLE_POOL.map((c) => ({ c, overlap: interestOverlap(me, c, { minLevel }) })).sort(
    (x, y) => quickRank(x.c) - quickRank(y.c) || y.overlap.score - x.overlap.score || x.c.name.localeCompare(y.c.name)
  );
}

async function chatWith(llm, me, { c, overlap }) {
  const r = await matchWithAgents(llm, me, c, { scenario: "friendship", turns: 6 });
  return {
    candidate: { ...publicProfile(c), tier: c.tier || "full" },
    sharedInterests: overlap.shared,
    score: r.judge.mutual,
    tier: tierOf(r.judge.mutual),
    reasons: r.judge.reasons,
    risks: r.judge.risks,
    icebreakers: r.judge.icebreakers,
    selfReasons: [r.selfA.reason, r.selfB.reason],
    gaps: r.gaps.A, // 我的分身答不上来的地方，单人体验里拿来演示“补一句”
    transcript: r.transcript,
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }
  const { me, error } = readMe(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const ranked = rank(me);
  const llm = createLLM({ config: { ...getLLMConfig(), ...WEB_LLM } });
  const meOut = { id: me.id, name: me.name, tier: me.tier || "full" };

  if (body.step === "shortlist") {
    return NextResponse.json({
      mode: llm.isMock ? "demo" : "live",
      me: meOut,
      shortlist: ranked.slice(0, SHORTLIST).map(({ c }) => ({ id: c.id, name: c.name, emoji: c.emoji })),
    });
  }

  if (body.candidateId) {
    const row = ranked.find(({ c }) => c.id === body.candidateId);
    if (!row) return NextResponse.json({ error: "没有这位候选人" }, { status: 400 });
    try {
      const match = await chatWith(llm, me, row);
      return NextResponse.json({ mode: llm.isMock ? "demo" : "live", me: meOut, match });
    } catch (e) {
      console.error("match error:", body.candidateId, e.message);
      return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
    }
  }

  // 旧接口：一次聊完
  const shortlist = ranked.slice(0, SHORTLIST);
  const settled = await Promise.allSettled(shortlist.map((row) => chatWith(llm, me, row)));
  const matches = settled
    .map((s) => (s.status === "fulfilled" ? s.value : null))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!matches.length) {
    console.error("match error:", settled.find((s) => s.status === "rejected")?.reason?.message);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
  return NextResponse.json({
    mode: llm.isMock ? "demo" : "live",
    me: meOut,
    screened: ranked.map(({ c, overlap }) => ({ id: c.id, name: c.name, overlap: Number(overlap.score.toFixed(2)) })),
    matches,
    usage: { calls: llm.stats.calls, promptTokens: llm.stats.promptTokens, completionTokens: llm.stats.completionTokens },
  });
}
