import { NextResponse } from "next/server";
import { getDB } from "@/lib/db.mjs";
import {
  SESSION_COOKIE,
  checkCommunityCode,
  checkNickname,
  checkPassword,
  hashPassword,
  makeSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth.mjs";
import { publicUser } from "@/lib/community.mjs";
import { fail, readJSON } from "../_http";

export const runtime = "nodejs";

// POST {action: "register" | "login" | "logout", nickname, password, code}
export async function POST(request) {
  const db = await getDB();
  if (!db) return fail("小区试点还没开启", 404);
  const body = await readJSON(request);
  const action = body?.action;

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return res;
  }

  const nick = checkNickname(body?.nickname);
  if (nick.error) return fail(nick.error);
  const pw = checkPassword(body?.password);
  if (pw.error) return fail(pw.error);

  let user;
  if (action === "register") {
    const code = checkCommunityCode(body?.code);
    if (code.error) return fail(code.error, 403);
    try {
      user = await db.users.create({ nickname: nick.nickname, nicknameKey: nick.key, passwordHash: hashPassword(pw.password) });
    } catch (e) {
      if (e.code === "nickname_taken") return fail("这个昵称已经有人用了，换一个吧", 409);
      console.error("register error:", e.message);
      return fail("注册失败，请稍后再试", 500);
    }
    await db.events.add({ user_id: user.id, type: "register" });
  } else if (action === "login") {
    user = await db.users.byKey(nick.key);
    if (!user || !verifyPassword(pw.password, user.password_hash)) return fail("昵称或密码不对", 401);
  } else {
    return fail("未知操作");
  }

  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, makeSessionToken(user.id), sessionCookieOptions());
  return res;
}
