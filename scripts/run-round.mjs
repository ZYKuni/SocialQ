#!/usr/bin/env node
// 每周开奖。在你自己的电脑上跑，读 .env.local 里的 Supabase 和大模型配置。
//
//   npm run round                     生成新一轮：选配对、跑分身对话，状态为“待审核”
//   npm run round -- --status         列出最近一轮的配对，审核用
//   npm run round -- --reject=<id>    去掉某个配对（也可以在 Supabase 里把 status 改成 rejected）
//   npm run round -- --publish        发布最近一轮，邻居打开“本周配对”就能看到
//
// 可选参数：--per-user=2（每人最多几个配对）、--min=10（能配对的卡少于这个数就不开奖）、--dry（只看选人结果，不跑对话不写库）

import { getDB, dbMode } from "../lib/db.mjs";
import { createLLM, getLLMConfig } from "../lib/llm.mjs";
import { matchWithAgents } from "../lib/agents.mjs";
import { eligible, history, personaFromRow, planPairs } from "../lib/community.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const PER_USER = Number(args["per-user"] || 2);
const MIN = Number(args.min || 10);
const CONCURRENCY = 4;

async function main() {
  if (!dbMode()) {
    console.error("没有配置数据库：在 .env.local 里填 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY（本地测试可用 COMMUNITY_DEV_DB=1）");
    process.exit(1);
  }
  const db = await getDB();
  const users = new Map((await db.users.all()).map((u) => [u.id, u]));
  const name = (id) => users.get(id)?.nickname || "（已注销）";

  if (args.status || args.reject || args.publish) {
    const round = await db.rounds.latest();
    if (!round) return console.log("还没有任何一轮。");
    if (args.reject) {
      await db.matches.update(String(args.reject), { status: "rejected" });
      console.log(`已去掉配对 ${args.reject}`);
    }
    const rows = await db.matches.inRound(round.id);
    console.log(`第 ${round.id} 轮 · ${round.status === "published" ? "已发布" : "待审核"} · ${rows.length} 个配对\n`);
    for (const m of rows) {
      const j = m.judge || {};
      console.log(`${m.status === "rejected" ? "✗" : "✓"} ${m.id}`);
      console.log(`  ${name(m.a_id)} × ${name(m.b_id)}  裁判分 ${j.mutual ?? "-"}  共同兴趣：${(m.shared || []).join("、") || "无"}`);
      if (args.status === "full" || args.status === "v") {
        for (const t of m.transcript || []) console.log(`    ${t.speaker === "A" ? name(m.a_id) : name(m.b_id)}：${t.text}`);
        for (const [side, id] of [["A", m.a_id], ["B", m.b_id]]) {
          for (const g of j.gaps?.[side] || []) console.log(`    · 会问 ${name(id)}：${g.ask}（对方说：${g.quote}）`);
        }
      }
    }
    if (args.publish) {
      if (round.status === "published") return console.log("\n这一轮已经发布过了。");
      await db.rounds.publish(round.id);
      console.log(`\n已发布第 ${round.id} 轮。可以在群里说一声“本周配对已出”。`);
    } else if (round.status !== "published") {
      console.log("\n逐条看对话：npm run round -- --status=full　去掉不合适的：--reject=<id>　确认后：--publish");
    }
    return;
  }

  const last = await db.rounds.latest();
  if (last && last.status !== "published" && !args.force) {
    console.error(`第 ${last.id} 轮还没发布。先审核并发布（--status / --publish），或加 --force 另开一轮。`);
    process.exit(1);
  }

  const rows = (await db.cards.latestAll()).filter((r) => eligible(r) && users.has(r.user_id));
  const people = rows.map((r) => ({ userId: r.user_id, persona: personaFromRow(r, users.get(r.user_id)) }));
  console.log(`能配对的卡：${people.length} 张（完整卡 ${people.filter((p) => p.persona.tier !== "quick").length}，速通卡 ${people.filter((p) => p.persona.tier === "quick").length}）`);
  if (people.length < MIN) {
    console.error(`少于 ${MIN} 张，先不开奖。人够了再跑，或用 --min=<数> 调低门槛。`);
    process.exit(1);
  }

  const { seen, blocked } = history(await db.matches.all(), await db.reports.all());
  const plan = planPairs(people, { perUser: PER_USER, seen, blocked });
  console.log(`选出 ${plan.length} 个配对：`);
  for (const p of plan) console.log(`  ${name(p.a.userId)} × ${name(p.b.userId)}  共同兴趣：${p.overlap.shared.join("、") || "无"}`);
  const unmatched = people.filter((p) => !plan.some((x) => x.a.userId === p.userId || x.b.userId === p.userId));
  if (unmatched.length) console.log(`这一轮没配上的：${unmatched.map((p) => name(p.userId)).join("、")}`);
  if (args.dry || !plan.length) return;

  const llm = createLLM({ config: getLLMConfig() });
  console.log(`\n开始跑分身对话（${llm.isMock ? "演示模式，没有大模型密钥" : llm.model}）...`);
  const results = new Array(plan.length);
  let next = 0;
  async function worker() {
    while (next < plan.length) {
      const i = next++;
      const { a, b } = plan[i];
      try {
        results[i] = await matchWithAgents(llm, a.persona, b.persona, { scenario: "friendship", turns: 6 });
        console.log(`  ✓ ${name(a.userId)} × ${name(b.userId)}  裁判分 ${results[i].judge.mutual}`);
      } catch (e) {
        console.log(`  ✗ ${name(a.userId)} × ${name(b.userId)}  失败：${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const done = plan.map((p, i) => [p, results[i]]).filter(([, r]) => r);
  if (!done.length) {
    console.error("全部失败，没有写入。检查大模型密钥和网络后重试。");
    process.exit(1);
  }
  const round = await db.rounds.create();
  await db.matches.addMany(
    done.map(([p, r]) => ({
      round_id: round.id,
      a_id: p.a.userId,
      b_id: p.b.userId,
      status: "approved",
      overlap: p.overlap.score,
      shared: p.overlap.shared,
      transcript: r.transcript,
      judge: { ...r.judge, usage: undefined, selfA: r.selfA.reason, selfB: r.selfB.reason, gaps: r.gaps },
    }))
  );
  const s = llm.stats;
  console.log(`\n第 ${round.id} 轮已生成，${done.length} 个配对，待审核。大模型调用 ${s.calls} 次，输入 ${s.promptTokens} / 输出 ${s.completionTokens} token。`);
  console.log("下一步：npm run round -- --status=full 看对话，没问题就 npm run round -- --publish");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
