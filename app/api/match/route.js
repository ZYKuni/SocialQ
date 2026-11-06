import { NextResponse } from "next/server";
import { createLLM, getLLMConfig } from "@/lib/llm.mjs";
import { matchWithAgents, tierOf } from "@/lib/agents.mjs";
import { normalizePersona, interestOverlap } from "@/lib/persona.mjs";
import { SAMPLE_POOL, publicProfile } from "@/lib/samplePool.mjs";

export const runtime = "nodejs";
export const maxDuration = 120;

const SHORTLIST = 3;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }
  if (!body?.persona) return NextResponse.json({ error: "缺少人格卡" }, { status: 400 });
  const me = normalizePersona(body.persona, { id: "me", name: body.persona.name || "我的claw", source: "chat" });
  if (me.cardVersion && !me.confirmedAt && me.tier !== "quick") {
    return NextResponse.json({ error: "人格卡还没确认，先回首页点“好了”" }, { status: 400 });
  }
  const meTier = me.tier || "full";
  // 速通卡的兴趣热度都是 6，用默认的 7 做门槛会一个共同兴趣都算不出来
  const minLevel = meTier === "quick" ? 6 : 7;

  // 第一层：零成本的兴趣重合粗筛；第二层：只对前几名跑 Agent 代聊（成本高）
  // 完整卡的候选人排在速通卡前面，避免认真做卡的人一直碰到信息很少的分身
  const quickRank = (c) => (c.tier === "quick" ? 1 : 0);
  const ranked = SAMPLE_POOL.map((c) => ({ c, overlap: interestOverlap(me, c, { minLevel }) })).sort(
    (x, y) => quickRank(x.c) - quickRank(y.c) || y.overlap.score - x.overlap.score || x.c.name.localeCompare(y.c.name)
  );
  const shortlist = ranked.slice(0, SHORTLIST);

  const llm = createLLM({ config: getLLMConfig() });
  const settled = await Promise.allSettled(
    shortlist.map(({ c }) => matchWithAgents(llm, me, c, { scenario: "friendship", turns: 6 }))
  );

  const matches = settled
    .map((s, i) => {
      if (s.status !== "fulfilled") return null;
      const { c, overlap } = shortlist[i];
      const r = s.value;
      return {
        candidate: { ...publicProfile(c), tier: c.tier || "full" },
        sharedInterests: overlap.shared,
        score: r.judge.mutual,
        tier: tierOf(r.judge.mutual),
        reasons: r.judge.reasons,
        risks: r.judge.risks,
        icebreakers: r.judge.icebreakers,
        selfReasons: [r.selfA.reason, r.selfB.reason],
        transcript: r.transcript,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!matches.length) {
    const reason = settled.find((s) => s.status === "rejected")?.reason?.message;
    console.error("match error:", reason);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }

  return NextResponse.json({
    mode: llm.isMock ? "demo" : "live",
    me: { id: me.id, name: me.name, tier: meTier },
    screened: ranked.map(({ c, overlap }) => ({ id: c.id, name: c.name, overlap: Number(overlap.score.toFixed(2)) })),
    matches,
    usage: { calls: llm.stats.calls, promptTokens: llm.stats.promptTokens, completionTokens: llm.stats.completionTokens },
  });
}
