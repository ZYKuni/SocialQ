#!/usr/bin/env node
// 小区试点的逻辑自查：账号、选人规则、本地文件数据库的完整一轮。不连网、不调大模型。
//   npm run check:community

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkCommunityCode,
  checkNickname,
  hashPassword,
  makeSessionToken,
  readSessionToken,
  verifyPassword,
} from "../lib/auth.mjs";
import { buildCard, buildQuickState, validateState, todayISO } from "../lib/socialState.mjs";
import { cardForOthers, history, matchView, personaFromRow, planPairs } from "../lib/community.mjs";

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

const env = { SESSION_SECRET: "test-secret", COMMUNITY_CODE: "NeighbourCode" };

await check("昵称规则：去空格、大小写不敏感、拒绝空格和符号", () => {
  assert.deepEqual(checkNickname("  Ethan "), { nickname: "Ethan", key: "ethan" });
  assert.ok(checkNickname("小赵_01").key);
  assert.ok(checkNickname("a").error);
  assert.ok(checkNickname("有 空格").error);
  assert.ok(checkNickname("x".repeat(17)).error);
});

await check("小区口令：不区分大小写；没配置时不能注册", () => {
  assert.ok(checkCommunityCode("neighbourcode", env).ok);
  assert.ok(checkCommunityCode("wrong", env).error);
  assert.ok(checkCommunityCode("anything", {}).error);
});

await check("密码哈希和会话签名", () => {
  const h = hashPassword("secret1");
  assert.ok(verifyPassword("secret1", h));
  assert.ok(!verifyPassword("secret2", h));
  const t = makeSessionToken("user-1", env);
  assert.equal(readSessionToken(t, env), "user-1");
  assert.equal(readSessionToken(t.replace(/.$/, (c) => (c === "a" ? "b" : "a")), env), null);
  assert.equal(readSessionToken(t, { SESSION_SECRET: "other" }), null);
  assert.equal(readSessionToken(makeSessionToken("u", env, 0), env), null, "过期的 cookie 应该无效");
});

// 几张测试卡
const today = todayISO();
const fullCard = (text, interests, extra = {}) => {
  const { state } = validateState({ interests, lookingFor: "一起玩的邻居", avoid: ["工作"], style: { text: "话少", catchphrases: [], confidence: 0.3 }, ...extra }, { userText: text, source: "guided", today });
  return buildCard({ state, tier: "full", confirmedAt: today });
};
const music = (entity, evidence) => ({ category: "music", type: null, entity, level: 8, evidence, disclosure: "match" });
const sport = (entity, evidence) => ({ category: "sports_play", type: null, entity, level: 8, evidence, disclosure: "match" });
const users = ["A", "B", "C", "D"].map((n) => ({ id: `id-${n}`, nickname: n }));
const rows = [
  { user_id: "id-A", tier: "full", confirmed_at: today, card: fullCard("最近单曲循环草东 周末打羽毛球", [music("草东没有派对", "单曲循环草东"), sport("羽毛球", "周末打羽毛球")]) },
  { user_id: "id-B", tier: "full", confirmed_at: today, card: fullCard("老粉了 草东 每周跑步", [music("草东没有派对", "老粉了 草东"), sport("跑步", "每周跑步")]) },
  { user_id: "id-C", tier: "full", confirmed_at: today, card: fullCard("每周打羽毛球", [sport("羽毛球", "每周打羽毛球")]) },
  { user_id: "id-D", tier: "quick", confirmed_at: today, card: buildCard({ state: buildQuickState({ categories: ["music", "sports_play"] }), tier: "quick", confirmedAt: today }) },
];
const people = rows.map((r) => ({ userId: r.user_id, persona: personaFromRow(r, users.find((u) => u.id === r.user_id)) }));

await check("对方只看得到匹配可见的条目，看不到不想聊和说话风格", () => {
  const v = cardForOthers(rows[0].card);
  assert.equal(v.interests.length, 2);
  assert.ok(!("avoid" in v) && !("style" in v));
  assert.ok(!JSON.stringify(v).includes("工作"));
});

await check("选人：共同兴趣优先，速通卡排在后面，每人不超过上限", () => {
  const plan = planPairs(people, { perUser: 1 });
  const pairs = plan.map((p) => [p.a.userId, p.b.userId].sort().join("+"));
  // A 和 C 只有羽毛球、兴趣重合度最高（1/2），先配；剩下的 B 和速通卡 D 配一对
  assert.ok(pairs.includes("id-A+id-C"), `A 和 C 重合度最高，应该先配：${pairs}`);
  assert.ok(pairs.includes("id-B+id-D"), `剩下的 B 和 D 配一对：${pairs}`);
  const plan2 = planPairs(people, { perUser: 2 });
  const count = {};
  for (const p of plan2) for (const id of [p.a.userId, p.b.userId]) count[id] = (count[id] || 0) + 1;
  assert.ok(Object.values(count).every((n) => n <= 2));
});

await check("选人：配过的和拉黑过的不再配", () => {
  const { seen, blocked } = history([{ a_id: "id-A", b_id: "id-B" }], [{ reporter_id: "id-C", target_id: "id-A" }]);
  const plan = planPairs(people, { perUser: 3, seen, blocked });
  const pairs = plan.map((p) => [p.a.userId, p.b.userId].sort().join("+"));
  assert.ok(!pairs.includes("id-A+id-B"));
  assert.ok(!pairs.includes("id-A+id-C"));
});

await check("配对页：微信号只在双方都想认识后出现", () => {
  const m = { id: "m1", a_id: "id-A", b_id: "id-B", transcript: [{ speaker: "A", text: "嗨" }], judge: { reasons: ["都喜欢草东"], icebreakers: ["你也听草东？"] }, shared: ["草东没有派对"], a_choice: "like", b_choice: null };
  const other = { nickname: "B", wechat: "b_wx" };
  assert.equal(matchView(m, users[0], other, rows[1].card).other.wechat, null);
  const both = matchView({ ...m, b_choice: "like" }, users[0], other, rows[1].card);
  assert.equal(both.other.wechat, "b_wx");
  assert.equal(both.transcript[0].mine, true);
  const fromB = matchView({ ...m, b_choice: "like" }, users[1], { nickname: "A", wechat: "" }, rows[0].card);
  assert.equal(fromB.transcript[0].mine, false);
  assert.deepEqual(fromB.icebreakers, [], "开场白是写给 A 的，B 不显示");
});

await check("本地文件数据库：注册、存卡、开奖、选择、注销级联删除", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sq-")), "db.json");
  const { getDB } = await import(`../lib/db.mjs?${Date.now()}`);
  const db = await getDB({ COMMUNITY_DEV_DB: "1", COMMUNITY_DEV_DB_PATH: file });
  const a = await db.users.create({ nickname: "A", nicknameKey: "a", passwordHash: "x" });
  const b = await db.users.create({ nickname: "B", nicknameKey: "b", passwordHash: "x" });
  await assert.rejects(db.users.create({ nickname: "a", nicknameKey: "a", passwordHash: "x" }), (e) => e.code === "nickname_taken");
  await db.cards.add({ user_id: a.id, version: 1, tier: "full", card: rows[0].card, confirmed_at: today });
  await db.cards.add({ user_id: a.id, version: 2, tier: "full", card: rows[0].card, confirmed_at: today });
  await db.cards.add({ user_id: b.id, version: 1, tier: "full", card: rows[1].card, confirmed_at: today });
  assert.equal((await db.cards.latest(a.id)).version, 2);
  assert.equal((await db.cards.latestAll()).length, 2);
  const round = await db.rounds.create();
  const [m] = await db.matches.addMany([{ round_id: round.id, a_id: a.id, b_id: b.id, status: "approved", shared: [], transcript: [], judge: {} }]);
  assert.equal(await db.rounds.latestPublished(), null);
  await db.rounds.publish(round.id);
  assert.equal((await db.matches.forUserInRound(b.id, round.id)).length, 1);
  await db.matches.update(m.id, { b_choice: "like" });
  assert.equal((await db.matches.byId(m.id)).b_choice, "like");
  await db.users.remove(a.id);
  assert.equal(await db.cards.latest(a.id), null);
  assert.equal((await db.matches.all()).length, 0);
  assert.equal((await db.users.all()).length, 1);
});

console.log(`\n${passed} 项通过${process.exitCode ? "，有失败项" : ""}`);
