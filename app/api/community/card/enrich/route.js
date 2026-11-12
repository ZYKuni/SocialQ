import { NextResponse } from "next/server";
import { createLLM, getLLMConfig } from "@/lib/llm.mjs";
import { enrichCard } from "@/lib/gaps.mjs";
import { CARD_VERSION } from "@/lib/socialState.mjs";
import { fail, readJSON, requireUser } from "../../_http";

export const runtime = "nodejs";
export const maxDuration = 60;

// 本周配对页“补一句”：POST {question, text, matchId?}
// 只生成预览，不保存：返回补完后的卡和新加了什么。用户点“加进去”后，前端再用 POST /api/community/card 存成新版本。
export async function POST(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  const body = await readJSON(request);
  const text = String(body?.text || "").trim();
  if (text.length < 2) return fail("多写几个字吧");
  const row = await db.cards.latest(user.id);
  const base = row?.card;
  if (base?.cardVersion !== CARD_VERSION || !base.state) return fail("你还没有分身卡，先去建一张");
  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { card, added } = await enrichCard(llm, base, { question: String(body?.question || ""), answer: text });
    await db.events.add({ user_id: user.id, type: "card_enrich_preview", data: { match: body?.matchId || null, added: added.length } });
    return NextResponse.json({ card, added });
  } catch (error) {
    console.error("card enrich error:", error.message);
    return fail("AI 服务暂时不可用，请稍后再试", 502);
  }
}
