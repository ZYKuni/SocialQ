import { NextResponse } from "next/server";
import { getDB } from "@/lib/db.mjs";
import { SESSION_COOKIE, checkPassword, hashPassword, sessionCookieOptions, verifyPassword } from "@/lib/auth.mjs";
import { currentUser, publicUser, eligible } from "@/lib/community.mjs";
import { fail, readJSON, requireUser } from "../_http";

export const runtime = "nodejs";

// GET：试点是否开启、当前用户、最新的卡、小区里已有几张能配对的卡
export async function GET(request) {
  const db = await getDB();
  if (!db) return NextResponse.json({ enabled: false });
  const user = await currentUser(request, db);
  const cards = await db.cards.latestAll();
  const members = cards.filter(eligible).length;
  if (!user) return NextResponse.json({ enabled: true, user: null, members });
  const row = await db.cards.latest(user.id);
  return NextResponse.json({ enabled: true, user: publicUser(user), card: row?.card || null, members });
}

// PATCH {wechat} 或 {password, newPassword}
export async function PATCH(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  const body = (await readJSON(request)) || {};
  const patch = {};
  if ("wechat" in body) patch.wechat = String(body.wechat || "").trim().slice(0, 40) || null;
  if ("newPassword" in body) {
    if (!verifyPassword(body.password, user.password_hash)) return fail("原密码不对", 401);
    const pw = checkPassword(body.newPassword);
    if (pw.error) return fail(pw.error);
    patch.password_hash = hashPassword(pw.password);
  }
  if (!Object.keys(patch).length) return fail("没有要改的内容");
  const updated = await db.users.update(user.id, patch);
  return NextResponse.json({ user: publicUser(updated) });
}

// DELETE：注销，删除这个人的全部卡片、配对、举报和行为记录
export async function DELETE(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  await db.users.remove(user.id);
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return out;
}
