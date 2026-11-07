import { NextResponse } from "next/server";
import { matchView } from "@/lib/community.mjs";
import { fail, readJSON, requireUser } from "../_http";

export const runtime = "nodejs";

// GET：最近一次已发布的开奖里，我的配对
export async function GET(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  const round = await db.rounds.latestPublished();
  if (!round) return NextResponse.json({ round: null, matches: [] });
  const [rows, reports] = await Promise.all([db.matches.forUserInRound(user.id, round.id), db.reports.all()]);
  const blockedByMe = new Set(reports.filter((r) => r.reporter_id === user.id).map((r) => r.target_id));
  const matches = [];
  for (const m of rows) {
    const otherId = m.a_id === user.id ? m.b_id : m.a_id;
    if (blockedByMe.has(otherId)) continue;
    const [other, otherCard] = await Promise.all([db.users.byId(otherId), db.cards.latest(otherId)]);
    matches.push(matchView(m, user, other, otherCard?.card));
  }
  await db.events.add({ user_id: user.id, type: "matches_viewed", data: { round: round.id, count: matches.length } });
  return NextResponse.json({ round: { id: round.id, publishedAt: round.published_at }, matches });
}

// POST {matchId, choice: "like" | "skip"}
export async function POST(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  const body = await readJSON(request);
  const choice = body?.choice;
  if (!["like", "skip"].includes(choice)) return fail("选择不对");
  const m = await db.matches.byId(String(body?.matchId || ""));
  if (!m || (m.a_id !== user.id && m.b_id !== user.id) || m.status !== "approved") return fail("找不到这个配对", 404);
  const field = m.a_id === user.id ? "a_choice" : "b_choice";
  const updated = await db.matches.update(m.id, { [field]: choice });
  await db.events.add({ user_id: user.id, type: "choice", data: { match: m.id, choice } });
  const otherId = m.a_id === user.id ? m.b_id : m.a_id;
  const [other, otherCard] = await Promise.all([db.users.byId(otherId), db.cards.latest(otherId)]);
  return NextResponse.json({ match: matchView(updated, user, other, otherCard?.card) });
}
