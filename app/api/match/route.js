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

  // 第一层：零成本的兴趣重合粗筛；第二层：只对前几名跑 Agent 代聊（成本高）
  const ranked = SAMPLE_POOL.map((c) => ({ c, overlap: interestOverlap(me, c) })).sort(
    (x, y) => y.overlap.score - x.overlap.score || x.c.name.localeCompare(y.c.name)
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
        candidate: publicProfile(c),
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
    me: { id: me.id, name: me.name },
    screened: ranked.map(({ c, overlap }) => ({ id: c.id, name: c.name, overlap: Number(overlap.score.toFixed(2)) })),
    matches,
    usage: { calls: llm.stats.calls, promptTokens: llm.stats.promptTokens, completionTokens: llm.stats.completionTokens },
  });
}
