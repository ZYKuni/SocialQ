// 分身卡生成评测：npm run eval:card
//
// 常用：
//   npm run eval:card                        跑全部用例（需要 .env.local 里的 LLM_API_KEY）
//   npm run eval:card -- --mock              演示模式，不花钱，只验证流程
//   npm run eval:card -- --set real          只跑真实用户
//   npm run eval:card -- --tag sparse        只跑带某个标签的用例
//   npm run eval:card -- --ids syn-01,adv-02
//   npm run eval:card -- --label new-prompt  给这次运行起名，方便之后对比
//   npm run eval:card -- --repeat 3          每条生成 3 次，看稳定性（只对第 1 次打分）
//   npm run eval:card -- --no-judge          只跑代码检查
//   npm run eval:card -- --export-human 10   抽 10 条导出给人工打分（校准裁判用）
//   npm run eval:card -- --strict            有门槛没达标时退出码非 0
//
// 输出：evals/persona-card/results/<时间>-<label>/{report.md, summary.json, results.jsonl}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { createLLM, getLLMConfig } from "../../lib/llm.mjs";
import { generate } from "./lib/pipeline.mjs";
import { runChecks } from "./lib/checks.mjs";
import { createJudge, judgeOne, cardForJudge, DIMS, DIM_NAMES } from "./lib/judge.mjs";
import { summarize, renderReport } from "./lib/report.mjs";
import { exportHuman } from "./lib/human.mjs";
import { CONFIG, DATASET_DIR, RESULTS_DIR, ROOT_DIR, loadEnv, readJSONL, writeJSONL, createDiskCache, pool, parseArgs, stamp, pct, fix } from "./lib/util.mjs";

loadEnv();
const args = parseArgs(process.argv.slice(2));
const mock = Boolean(args.mock);
const repeat = Math.max(1, Number(args.repeat || 1));
const label = String(args.label || (mock ? "mock" : "run")).replace(/[^\w一-龥-]/g, "_");

// ---------- 用例 ----------
export function loadCases({ sets, ids, tag, limit } = {}) {
  const files = fs.readdirSync(DATASET_DIR).filter((f) => f.endsWith(".jsonl") && !f.includes(".example."));
  let cases = files.flatMap((f) => readJSONL(path.join(DATASET_DIR, f)).map((c) => ({ set: f.replace(/\.jsonl$/, ""), ...c })));
  const seen = new Set();
  for (const c of cases) {
    if (!c.id) throw new Error(`有用例缺少 id：${JSON.stringify(c).slice(0, 80)}`);
    if (seen.has(c.id)) throw new Error(`用例 id 重复：${c.id}`);
    seen.add(c.id);
    if (c.source === "chat_paste" ? !c.chatText : !Array.isArray(c.answers)) throw new Error(`用例 ${c.id}：guided 要有 answers，chat_paste 要有 chatText`);
  }
  if (sets) cases = cases.filter((c) => sets.includes(c.set));
  if (ids) cases = cases.filter((c) => ids.includes(c.id));
  if (tag) cases = cases.filter((c) => (c.tags || []).includes(tag));
  if (limit) cases = cases.slice(0, Number(limit));
  return cases;
}

function fingerprint() {
  const h = crypto.createHash("sha256");
  for (const f of ["lib/agents.mjs", "lib/socialState.mjs", "lib/privacy.mjs", "skills/icebreak-topics/taxonomy.json", "skills/icebreak-topics/lexicon.json"]) {
    h.update(fs.readFileSync(path.join(ROOT_DIR, f)));
  }
  return h.digest("hex").slice(0, 8);
}

function gitCommit() {
  try {
    const dirty = execSync("git status --porcelain -- lib skills", { cwd: ROOT_DIR }).toString().trim() ? "+改动" : "";
    return execSync("git rev-parse --short HEAD", { cwd: ROOT_DIR }).toString().trim() + dirty;
  } catch {
    return "unknown";
  }
}

async function main() {
  const cases = loadCases({
    sets: args.set ? String(args.set).split(",") : null,
    ids: args.ids ? String(args.ids).split(",") : null,
    tag: args.tag,
    limit: args.limit,
  });
  if (!cases.length) throw new Error("没有选中任何用例");

  const genConfig = mock ? { provider: "mock" } : getLLMConfig();
  if (!mock && genConfig.provider === "mock") {
    throw new Error("没有找到 LLM_API_KEY。在 .env.local 里配置，或者加 --mock 用演示模式跑通流程。");
  }
  const useCache = !args["no-cache"];
  const gens = Array.from({ length: repeat }, (_, r) => createLLM({ config: genConfig, cache: useCache ? createDiskCache(undefined, r ? `repeat${r}:` : "") : null }));
  const judge = args["no-judge"] ? null : createJudge({ cache: useCache ? createDiskCache() : null, mock });

  const dir = path.join(RESULTS_DIR, `${stamp()}-${label}`);
  const meta = {
    label,
    time: new Date().toISOString(),
    commit: gitCommit(),
    fingerprint: fingerprint(),
    model: gens[0].model,
    judgeModel: judge ? judge.model : "（未打分）",
    mock,
    repeat,
    dirRel: path.relative(ROOT_DIR, dir),
  };
  console.log(`分身卡评测：${cases.length} 条用例 × ${repeat} 次 · 生成 ${meta.model} · 裁判 ${meta.judgeModel}${mock ? " · 演示模式" : ""}`);

  const jobs = cases.flatMap((c) => Array.from({ length: repeat }, (_, r) => ({ c, r })));
  let done = 0;
  const rows = await pool(jobs, Number(args.concurrency || CONFIG.concurrency), async ({ c, r }) => {
    const gen = await generate(gens[r], c);
    const { checks, metrics } = runChecks(c, gen);
    const judgeRes = {};
    if (judge && r === 0) {
      for (const d of DIMS) judgeRes[d] = await judgeOne(judge, d, c, gen, { mockChecks: checks });
    }
    const failReasons = [
      ...checks.filter((x) => x.severity === "hard" && !x.pass).map((x) => `硬规则 ${x.id}${x.detail ? `：${x.detail}` : ""}`),
      ...DIMS.filter((d) => judgeRes[d]?.score != null && judgeRes[d].score < CONFIG.pass[d]).map((d) => `${DIM_NAMES[d]} ${judgeRes[d].score} 分：${judgeRes[d].reason}`),
    ];
    done += 1;
    if (done % 5 === 0 || done === jobs.length) process.stdout.write(`  ${done}/${jobs.length}\n`);
    return {
      id: c.id,
      set: c.set,
      tags: c.tags || [],
      source: c.source || "guided",
      note: c.note || "",
      repeat: r,
      userText: gen.userText,
      privacy: gen.privacy,
      error: gen.error,
      raw: gen.raw,
      state: gen.state,
      stateForJudge: cardForJudge(gen.state),
      thin: gen.card?.thin ?? null,
      dropped: gen.dropped,
      checks,
      metrics,
      judge: judgeRes,
      pass: failReasons.length === 0,
      failReasons,
      human: c.human || null,
      usage: gen.usage,
      latencyMs: gen.latencyMs,
    };
  });

  const summary = summarize(rows);
  fs.mkdirSync(dir, { recursive: true });
  writeJSONL(path.join(dir, "results.jsonl"), rows);
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ meta, summary }, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), renderReport(meta, summary, rows));
  if (args["export-human"]) exportHuman(dir, rows.filter((r) => r.repeat === 0), Number(args["export-human"]) || 10);

  console.log("");
  for (const g of summary.gates) console.log(`  ${g.ok == null ? "·" : g.ok ? "✓" : "✗"} ${g.name.padEnd(16, "　")} ${g.shown}（${g.targetShown}）`);
  console.log(`  用例通过率 ${pct(summary.passRate)}　忠实 ${fix(summary.judge.faithfulness.mean)} · 语气 ${fix(summary.judge.tone.mean)} · 隐私 ${fix(summary.judge.privacy.mean)}`);
  console.log(`\n报告：${path.relative(process.cwd(), path.join(dir, "report.md"))}`);
  if (args.strict && summary.gates.some((g) => g.ok === false)) process.exit(1);
}

main().catch((error) => {
  console.error(`评测失败：${error.message}`);
  process.exit(1);
});
