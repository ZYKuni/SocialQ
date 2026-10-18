// 第 3 步：大模型组（需要在 .env.local 配置 LLM_API_KEY；没配置时自动用 mock 跑通流程，结果无意义）
//  L1        只看双方档案，裁判直接判断（不代聊）
//  L2-self   双方 AI 分身代聊 6 句 -> 各自站在主人角度判断“愿不愿意再联系”，两人概率相乘
//  L2-judge  双方档案 + 代聊记录 -> 裁判判断（与 L1 的 prompt 只差“代聊记录”这一块）
//
// 用法：
//   node experiments/speed-dating/03_llm.mjs --limit 20        # 先跑 20 对试点，看输出是否正常
//   node experiments/speed-dating/03_llm.mjs                   # 跑完整评测集（可随时中断，重跑会跳过已完成的配对）
// 参数：--limit N  --concurrency 6  --arms L1,L2  --turns 6

import fs from "node:fs";
import { P, readJSON, loadEnv, createDiskCache, runPool, ensureDir } from "./lib/util.mjs";
import { createLLM, getLLMConfig } from "../../lib/llm.mjs";
import { judgePair, matchWithAgents } from "../../lib/agents.mjs";

loadEnv();
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const LIMIT = Number(arg("limit", 0)) || Infinity;
const CONCURRENCY = Number(arg("concurrency", 6));
const ARMS = String(arg("arms", "L1,L2")).split(",");
const TURNS = Number(arg("turns", 6));
const PRICE_IN = Number(process.env.LLM_PRICE_IN_PER_M || 2); // 元 / 百万输入 token（按 DeepSeek 官网价格自行调整）
const PRICE_OUT = Number(process.env.LLM_PRICE_OUT_PER_M || 8); // 元 / 百万输出 token

const config = getLLMConfig();
const cache = createDiskCache();
const llm = createLLM({ config, cache });
if (llm.isMock) {
  console.warn("\n⚠️  没有检测到 LLM_API_KEY，当前使用 mock 模式：只用来检查流程，结果没有任何意义。\n");
} else {
  console.log(`模型：${config.model} @ ${config.baseURL}，并发 ${CONCURRENCY}，缓存已有 ${cache.size()} 条`);
}

const people = readJSON(P.people);
const pairs = new Map(readJSON(P.pairs).map((p) => [p.id, p]));
const ids = readJSON(P.sample).ids.slice(0, LIMIT);

ensureDir(P.predLLM);
const done = new Set();
if (fs.existsSync(P.predLLM)) {
  for (const line of fs.readFileSync(P.predLLM, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r.error && r.model === llm.model) done.add(`${r.id}|${r.arm}`);
    } catch {
      /* 跳过半行 */
    }
  }
}

const jobs = [];
for (const id of ids) for (const arm of ARMS) if (!done.has(`${id}|${arm}`)) jobs.push({ id, arm });
console.log(`评测集 ${ids.length} 对，待跑任务 ${jobs.length} 个（已完成 ${done.size} 个）`);

let finished = 0;
const started = Date.now();
const write = (rec) => fs.appendFileSync(P.predLLM, `${JSON.stringify({ ...rec, model: llm.model, ts: new Date().toISOString() })}\n`);

await runPool(jobs, CONCURRENCY, async ({ id, arm }) => {
  const pair = pairs.get(id);
  const A = people[pair.a].card;
  const B = people[pair.b].card;
  const t0 = Date.now();
  try {
    if (arm === "L1") {
      const j = await judgePair(llm, A, B, { scenario: "speed_dating" });
      write({ id, arm, aWantsB: j.aWantsB, bWantsA: j.bWantsA, reasons: j.reasons, usage: j.usage, ms: Date.now() - t0 });
    } else if (arm === "L2") {
      const r = await matchWithAgents(llm, A, B, { scenario: "speed_dating", turns: TURNS });
      write({
        id,
        arm,
        transcript: r.transcript,
        selfA: r.selfA.probability,
        selfB: r.selfB.probability,
        selfReasons: [r.selfA.reason, r.selfB.reason],
        judgeAWantsB: r.judge.aWantsB,
        judgeBWantsA: r.judge.bWantsA,
        reasons: r.judge.reasons,
        risks: r.judge.risks,
        usage: r.usage,
        ms: Date.now() - t0,
      });
    }
  } catch (error) {
    write({ id, arm, error: String(error.message || error).slice(0, 300) });
    console.error(`✗ ${id} ${arm}: ${error.message}`);
  }
  finished += 1;
  if (finished % 10 === 0 || finished === jobs.length) {
    const s = llm.stats;
    const cost = (s.promptTokens / 1e6) * PRICE_IN + (s.completionTokens / 1e6) * PRICE_OUT;
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`进度 ${finished}/${jobs.length} · 调用 ${s.calls}（缓存命中 ${s.cachedCalls}）· token ${s.promptTokens}+${s.completionTokens} · 约 ¥${cost.toFixed(2)} · ${mins} 分钟`);
  }
});

console.log("完成。下一步：node experiments/speed-dating/04_evaluate.mjs");
