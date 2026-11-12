// 人格卡 v2 的检查脚本：npm run check:persona
// 在演示模式下跑，不花模型费用。场景来自 skills/persona-card/SKILL.md 的“测试场景”，再加两条。

import assert from "node:assert/strict";
import { createLLM } from "../lib/llm.mjs";
import { decideFollowup, extractState, runAgentChat, judgePair, matchWithAgents } from "../lib/agents.mjs";
import { gapsFromTranscript, enrichCard } from "../lib/gaps.mjs";
import { validateState, buildCard, buildQuickState, isThin } from "../lib/socialState.mjs";
import { normalizePersona, interestOverlap, renderPersona } from "../lib/persona.mjs";
import { prepareChatForLLM } from "../lib/privacy.mjs";
import { SAMPLE_POOL } from "../lib/samplePool.mjs";

const llm = createLLM({ config: { provider: "mock" } });
const today = "2026-11-06";
const results = [];

async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

/** 模拟一遍三问：每题的回答 + 追问时的回答 */
async function runGuided(script) {
  const answers = [];
  const asked = [];
  for (const [question, answer, followupAnswer] of script) {
    const f = await decideFollowup(llm, { question, answer });
    const row = { question, answer };
    if (f.action === "followup") {
      asked.push(question);
      row.followup = f.text;
      row.followupAnswer = followupAnswer || "";
      // 每题最多追问一次：已追问过时不再追问
      const again = await decideFollowup(llm, { question, answer: followupAnswer || "x", askedFollowup: true });
      assert.equal(again.action, "next", "同一题不应追问第二次");
    }
    answers.push(row);
  }
  const userText = answers.flatMap((a) => [a.answer, a.followupAnswer]).filter(Boolean).join("\n");
  const { raw } = await extractState(llm, userText, { source: "guided", today });
  const { state, dropped } = validateState(raw, { userText, source: "guided", today });
  return { state, dropped, asked, card: buildCard({ state, source: "guided", today }) };
}

await scenario("1. 话很少的用户：追问后接受，标 thin，不编造具体对象", async () => {
  const { card, asked } = await runGuided([
    [1, "听歌", "不知道"],
    [2, "没啥"],
    [3, "都行", "没有"],
  ]);
  assert.ok(asked.includes(1), "Q1 只说了大类，应该追问");
  assert.equal(card.thin, true);
  assert.ok(card.state.interests.every((i) => !i.entity), "不应出现用户没说过的具体对象");
});

await scenario("2a. 只说大类的用户：追问后拿到具体对象", async () => {
  const { state, asked } = await runGuided([
    [1, "喜欢看电影、打游戏", "最近在玩原神"],
    [2, "没啥特别的"],
    [3, "能一起开黑的朋友，别问我工作"],
  ]);
  assert.ok(asked.includes(1));
  assert.ok(state.interests.some((i) => i.entity === "原神"), "追问后应拿到原神");
});

await scenario("2b. 只说大类的用户：追问后仍没有，就停在大类或类型层", async () => {
  const { state } = await runGuided([
    [1, "喜欢看电影、打游戏", "没有特别的"],
    [2, "没啥特别的"],
    [3, "都行"],
  ]);
  assert.ok(state.interests.length > 0);
  assert.ok(state.interests.every((i) => !i.entity));
});

await scenario("3. 带敏感信息的聊天记录：脱敏、不留学校、不收对方的话、默认仅自己的分身", async () => {
  const chat = `我：我手机号 13812345678 加我
阿杰：我超爱周杰伦
我：我们学校食堂今天又是土豆
我：周六又去爬山了 腿废
我：最近在打星铁 每天都玩
阿杰：哈哈哈`;
  const prepared = prepareChatForLLM(chat, []);
  assert.ok(!prepared.text.includes("13812345678"), "手机号应被脱敏");
  assert.ok(!prepared.text.includes("周杰伦"), "对方的消息不应进入模型");
  const { raw } = await extractState(llm, prepared.text, { source: "chat_paste", today });
  // 再塞一条模型可能给出的学校条目，确认校验会丢掉
  raw.interests.push({ category: "food", type: null, entity: "学校食堂", level: 6, evidence: "我们学校食堂今天又是土豆" });
  const { state } = validateState(raw, { userText: prepared.text, source: "chat_paste", today });
  const json = JSON.stringify(state);
  assert.ok(!json.includes("学校"), "学校不应出现在任何条目里");
  assert.ok(!json.includes("周杰伦"));
  assert.ok(state.interests.length > 0);
  assert.ok(state.interests.every((i) => i.disclosure === "self_agent"), "粘贴来源默认仅自己的分身");
});

await scenario("4. 大模型编造证据：原话里没有的证据被丢弃", async () => {
  const userText = "最近在追悬疑剧";
  const raw = {
    interests: [
      { category: "film_tv", type: "悬疑", entity: null, level: 7, evidence: "最近在追悬疑剧" },
      { category: "music", type: "说唱", entity: "某说唱歌手", level: 9, evidence: "天天听说唱" },
      { category: "music", type: "说唱", entity: null, level: 9 },
    ],
  };
  const { state, dropped } = validateState(raw, { userText, source: "guided", today });
  assert.equal(state.interests.length, 1);
  assert.equal(dropped.filter((d) => d.kind === "interest").length, 2);
});

await scenario("5. 速通卡进入匹配：粗筛能算出共同兴趣，代聊带速通卡规则，裁判看不到仅自己的内容", async () => {
  const state = buildQuickState({ categories: ["games", "acg"], recent: "星铁" }, today);
  const card = normalizePersona(buildCard({ state, tier: "quick", source: "quick", confirmedAt: today, today }), { id: "me", name: "测试", source: "chat" });
  assert.equal(card.tier, "quick");
  assert.ok(card.state.interests.some((i) => i.entity === "崩坏：星穹铁道"));
  const best = Math.max(...SAMPLE_POOL.map((c) => interestOverlap(card, c, { minLevel: 6 }).score));
  const old = Math.max(...SAMPLE_POOL.map((c) => interestOverlap(card, c).score));
  assert.ok(best > 0, "minLevel 6 时应能和示例用户对上兴趣");
  assert.equal(old, 0, "说明默认门槛 7 下速通卡对不上，所以 minLevel 参数是必要的");

  const prompts = [];
  const spy = {
    chat: async (p) => {
      prompts.push(p.messages.map((m) => m.content).join("\n"));
      return p.json
        ? { json: { a_wants_b: 50, b_wants_a: 50, reasons: [], risks: [], icebreakers: [] }, usage: {} }
        : { content: "你好", usage: {} };
    },
  };
  await runAgentChat(spy, card, SAMPLE_POOL[0], { turns: 1 });
  assert.ok(prompts[0].includes("速通卡规则"), "速通卡的分身 prompt 应带速通卡规则");

  // 完整卡：avoid 和仅自己的分身的兴趣不应进入裁判的档案
  const full = buildCard({
    state: {
      ...buildQuickState({ categories: ["music"] }, today),
      interests: [
        { category: "music", type: "摇滚", entity: "某乐队", level: 8, evidence: "x", source: "guided", disclosure: "match" },
        { category: "games", type: null, entity: "秘密游戏", level: 8, evidence: "y", source: "chat_paste", disclosure: "self_agent" },
      ],
      avoid: ["前任"],
    },
    confirmedAt: today,
    today,
  });
  prompts.length = 0;
  await judgePair(spy, full, SAMPLE_POOL[1], {});
  const judged = prompts[0];
  assert.ok(judged.includes("某乐队"));
  assert.ok(!judged.includes("秘密游戏") && !judged.includes("前任"), "裁判不应看到仅自己的分身的内容");
  assert.ok(renderPersona(full).includes("前任"), "自己的分身应该知道不聊什么");
  assert.ok(!full.interests.some((i) => i.name === "秘密游戏"), "粗筛用的旧字段也不应包含仅自己的内容");
  assert.equal(isThin(full.state, today), true, "只有 1 个对外可见的具体对象、没有近况，应算 thin");
});

await scenario("6. 从代聊补卡：找出分身答不上来的地方，本人补一句后并进卡，问题里的词不算原话", async () => {
  // 规则版：取对方上一句当作问住分身的话
  const t = [
    { speaker: "A", text: "我平时打三角洲，你呢" },
    { speaker: "B", text: "三角洲我没怎么接触过，你给我讲讲" },
    { speaker: "A", text: "射击类的" },
    { speaker: "B", text: "我主要听歌" },
  ];
  assert.deepEqual(gapsFromTranscript(t, "B").map((g) => g.quote), ["我平时打三角洲，你呢"]);
  assert.equal(gapsFromTranscript(t, "A").length, 0);

  // 代聊结果里带 gaps，最多 2 条，引用必须是对方说过的话
  const me = buildCard({ state: validateState({ interests: [{ category: "music", entity: "薛之谦", level: 6, evidence: "在听薛之谦" }], lookingFor: "能一起玩的搭子" }, { userText: "在听薛之谦\n能一起玩的搭子", today }).state, confirmedAt: today, today });
  const r = await matchWithAgents(llm, normalizePersona(me, { id: "me", name: "我" }), SAMPLE_POOL[3], { turns: 6 });
  assert.ok(r.gaps && Array.isArray(r.gaps.A) && Array.isArray(r.gaps.B));
  assert.ok(r.gaps.A.length <= 2 && r.gaps.B.length <= 2);
  const bLines = r.transcript.filter((m) => m.speaker === "B").map((m) => m.text);
  for (const g of r.gaps.A) assert.ok(bLines.some((x) => x.includes(g.quote)), "gap 的引用应是对方分身的原话");

  // 补一句：新兴趣进卡，可见范围是匹配可见，卡仍是已确认
  const { card, added } = await enrichCard(llm, me, { question: "你玩过塞尔达吗？", answer: "最近在玩原神，每天都玩", today });
  assert.ok(card.state.interests.some((i) => i.entity === "原神"), `应加上原神：${JSON.stringify(card.state.interests)}`);
  assert.ok(!card.state.interests.some((i) => /塞尔达/.test(i.entity || "")), "问题里的塞尔达不应被记成用户说过");
  assert.ok(added.length >= 1);
  assert.equal(card.confirmedAt, today, "补卡不应让卡变回未确认");
  assert.ok(card.state.interests.filter((i) => i.entity === "原神").every((i) => i.disclosure === "match"));
  // 原有的条目不丢
  assert.ok(card.state.interests.some((i) => i.entity === "薛之谦"));

  // 什么都没说出来时不加东西
  const none = await enrichCard(llm, me, { question: "平时还玩什么？", answer: "没啥", today });
  assert.equal(none.added.length, 0);
});

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `\n    ${r.error}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
