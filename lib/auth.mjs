// 小区试点的账号：昵称 + 密码。注册时要输入小区口令（环境变量 COMMUNITY_CODE），挡住小区外的人。
// 密码用 scrypt 加盐哈希；登录状态是一个用 SESSION_SECRET 签名的 httpOnly cookie，不另建会话表。

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export const SESSION_COOKIE = "sq_session";
const SESSION_DAYS = 60;

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;
export const PASSWORD_MIN = 6;

/** 昵称去掉首尾空格；只允许中英文、数字、下划线和短横线。返回 {nickname, key} 或 {error}。 */
export function checkNickname(raw) {
  const nickname = String(raw || "").trim();
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) return { error: `昵称要 ${NICKNAME_MIN} 到 ${NICKNAME_MAX} 个字` };
  if (!/^[\p{Script=Han}A-Za-z0-9_\-]+$/u.test(nickname)) return { error: "昵称只能用中英文、数字、下划线和短横线" };
  return { nickname, key: nickname.toLowerCase() };
}

export function checkPassword(raw) {
  const password = String(raw || "");
  if (password.length < PASSWORD_MIN) return { error: `密码至少 ${PASSWORD_MIN} 位` };
  if (password.length > 64) return { error: "密码太长了" };
  return { password };
}

/** 小区口令。没配置 COMMUNITY_CODE 时不允许注册，避免线上忘了配置就对所有人开放。 */
export function checkCommunityCode(raw, env = process.env) {
  const expected = env.COMMUNITY_CODE || (env.COMMUNITY_DEV_DB === "1" ? "dev" : "");
  if (!expected) return { error: "还没配置小区口令，暂时不能注册" };
  const a = Buffer.from(String(raw || "").trim().toLowerCase());
  const b = Buffer.from(expected.trim().toLowerCase());
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: "小区口令不对" };
  return { ok: true };
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(String(password || ""), Buffer.from(saltB64, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

function secret(env = process.env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.COMMUNITY_DEV_DB === "1") return "dev-only-session-secret";
  throw new Error("缺少 SESSION_SECRET 环境变量");
}

const sign = (payload, env) => createHmac("sha256", secret(env)).update(payload).digest("base64url");

export function makeSessionToken(userId, env = process.env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload, env)}`;
}

/** 校验 cookie，返回 userId 或 null。 */
export function readSessionToken(token, env = process.env, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = sign(`${userId}.${exp}`, env);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) * 1000 < now) return null;
  return userId;
}

export const sessionCookieOptions = (env = process.env) => ({
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 86400,
});
