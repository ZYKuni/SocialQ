import { NextResponse } from "next/server";
import { fail, readJSON, requireUser } from "../_http";

export const runtime = "nodejs";

// POST {matchId, reason}：举报并拉黑配对里的对方。之后不再互相推荐，这一轮的配对也对我隐藏。
export async function POST(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  const body = await readJSON(request);
  const m = await db.matches.byId(String(body?.matchId || ""));
  if (!m || (m.a_id !== user.id && m.b_id !== user.id)) return fail("找不到这个配对", 404);
  const targetId = m.a_id === user.id ? m.b_id : m.a_id;
  await db.reports.add({ reporter_id: user.id, target_id: targetId, reason: String(body?.reason || "").slice(0, 300) || null });
  const field = m.a_id === user.id ? "a_choice" : "b_choice";
  await db.matches.update(m.id, { [field]: "skip" });
  return NextResponse.json({ ok: true });
}
