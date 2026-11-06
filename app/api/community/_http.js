import { NextResponse } from "next/server";
import { getDB } from "@/lib/db.mjs";
import { currentUser } from "@/lib/community.mjs";

// 小区试点接口的公共部分：取数据层、取当前用户、统一的错误返回。

export const fail = (error, status = 400) => NextResponse.json({ error }, { status });

export async function readJSON(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** 返回 {db, user}；没开启试点或没登录时返回一个错误响应。 */
export async function requireUser(request) {
  const db = await getDB();
  if (!db) return { res: fail("小区试点还没开启", 404) };
  const user = await currentUser(request, db);
  if (!user) return { res: fail("请先登录", 401) };
  return { db, user };
}
