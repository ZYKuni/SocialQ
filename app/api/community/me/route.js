import { NextResponse } from "next/server";
import { getDB } from "@/lib/db.mjs";
import { SESSION_COOKIE, checkNickname, checkPassword, hashPassword, sessionCookieOptions, verifyPassword } from "@/lib/auth.mjs";
import { currentUser, publicUser, eligible } from "@/lib/community.mjs";
import { fail, readJSON, requireUser } from "../_http";

export const runtime = "nodejs";

// GET：试点是否开启、当前用户、最新的卡、小区里已有几张能配对的卡
// 试点开启了但数据库连不上时返回 503 和原因，前端显示出来，而不是悄悄退回演示模式。
// 只报告环境变量有没有配，不回显任何值。
export async function GET(request) {
  const env = process.env;
  const configured = {
    SUPABASE_URL: Boolean(env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    COMMUNITY_CODE: Boolean(env.COMMUNITY_CODE),
    SESSION_SECRET: Boolean(env.SESSION_SECRET),
  };
  try {
    const db = await getDB();
    if (!db) return NextResponse.json({ enabled: false, configured });
    const user = await currentUser(request, db);
    const cards = await db.cards.latestAll();
    const members = cards.filter(eligible).length;
    if (!user) return NextResponse.json({ enabled: true, user: null, members });
    const row = await db.cards.latest(user.id);
    return NextResponse.json({ enabled: true, user: publicUser(user), card: row?.card || null, members });
  } catch (e) {
    console.error("community me error:", e);
    const hint = /permission denied/i.test(e.message)
      ? "（表没授权给 service_role：在 Supabase SQL Editor 里重新运行 supabase/schema.sql，并确认用的是 sb_secret_ 开头的 key）"
      : /relation .* does not exist|Could not find the table/i.test(e.message)
        ? "（还没建表：在 Supabase SQL Editor 里运行 supabase/schema.sql）"
        : "";
    return NextResponse.json({ enabled: true, error: `数据库连接失败：${e.message}${hint}`, configured }, { status: 503 });
  }
}

// PATCH {nickname}、{wechat} 或 {password, newPassword}
export async function PATCH(request) {
  const { db, user, res } = await requireUser(request);
  if (res) return res;
  const body = (await readJSON(request)) || {};
  const patch = {};
  if ("nickname" in body) {
    const n = checkNickname(body.nickname);
    if (n.error) return fail(n.error);
    if (n.nickname !== user.nickname) Object.assign(patch, { nickname: n.nickname, nickname_key: n.key });
  }
  if ("wechat" in body) patch.wechat = String(body.wechat || "").trim().slice(0, 40) || null;
  if ("newPassword" in body) {
    if (!verifyPassword(body.password, user.password_hash)) return fail("原密码不对", 401);
    const pw = checkPassword(body.newPassword);
    if (pw.error) return fail(pw.error);
    patch.password_hash = hashPassword(pw.password);
  }
  if (!Object.keys(patch).length) return "nickname" in body ? NextResponse.json({ user: publicUser(user) }) : fail("没有要改的内容");
  let updated;
  try {
    updated = await db.users.update(user.id, patch);
  } catch (e) {
    if (e.code === "nickname_taken") return fail("这个昵称已经有人用了，换一个吧", 409);
    throw e;
  }
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
