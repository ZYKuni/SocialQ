import { NextResponse } from "next/server";
import { CARD_VERSION, todayISO } from "@/lib/socialState.mjs";
import { fail, readJSON, requireUser } from "../_http";

export const runtime = "nodejs";

const MAX_BYTES = 40_000;

// POST {card}：保存一个新版本的人格卡（只追加，不覆盖）
export async function POST(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  const body = await readJSON(request);
  const card = body?.card;
  if (!card || card.cardVersion !== CARD_VERSION || typeof card.state !== "object") return fail("卡片格式不对");
  if (JSON.stringify(card).length > MAX_BYTES) return fail("卡片太大了");
  const tier = card.tier === "quick" ? "quick" : "full";
  if (tier === "full" && !card.confirmedAt) return fail("完整卡要先在确认页点“好了”");

  const last = await db.cards.latest(user.id);
  const version = (last?.version || 0) + 1;
  const saved = { ...card, id: user.id, name: user.nickname, tier, version, confirmedAt: card.confirmedAt || todayISO() };
  await db.cards.add({ user_id: user.id, version, tier, card: saved, confirmed_at: new Date().toISOString() });
  await db.events.add({ user_id: user.id, type: "card_saved", data: { version, tier, thin: Boolean(card.thin) } });
  return NextResponse.json({ card: saved });
}
