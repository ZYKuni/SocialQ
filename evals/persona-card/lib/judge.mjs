// LLM 裁判（第二版）：裁判只做“逐条判断”，分数由代码按固定规则算。
//
// 为什么不让裁判直接打 1-5 分：整体分噪声大，3 和 4 的界线每次都在漂，而且没法和人对答案。
// 逐条的是非题（这条卡上的内容，用户说过吗？）裁判答得稳，人也能几秒钟标一条，校准时一条条对。
//
//   忠实 faithfulness：卡上每一条 → ok / distorted / unsupported；另列出漏掉的内容
//   语气 tone        ：六个是非题（套话、拔高、换词、像简历、风格空泛、语言不匹配）
//   隐私 privacy     ：列出违规项，每项归类 never / boundary / not_shared / edge
//
// 每个维度单独调用一次，温度 0，结果走磁盘缓存。
// 裁判模型可以和生成模型不同：设置 JUDGE_MODEL / JUDGE_BASE_URL / JUDGE_API_KEY，没设就用 LLM_*。

import fs from "node:fs";
import path from "node:path";
import { createLLM, getLLMConfig } from "../../../lib/llm.mjs";
import { categoryName } from "../../../lib/socialState.mjs";
import { RUBRIC_DIR } from "./util.mjs";

export const DIMS = ["faithfulness", "tone", "privacy"];
export const DIM_NAMES = { faithfulness: "忠实", tone: "语气", privacy: "隐私", format: "格式" };

const rubric = (dim) => fs.readFileSync(path.join(RUBRIC_DIR, `${dim}.md`), "utf8");

export function judgeConfig(env = process.env, { mock = false } = {}) {
  if (mock) return { provider: "mock" };
  const base = getLLMConfig(env);
  return {
    ...base,
    apiKey: env.JUDGE_API_KEY || base.apiKey,
    baseURL: (env.JUDGE_BASE_URL || base.baseURL).replace(/\/+$/, ""),
    model: env.JUDGE_MODEL || base.model,
    provider: env.JUDGE_API_KEY || base.apiKey ? "openai-compatible" : "mock",
  };
}

export function createJudge({ cache, mock = false } = {}) {
  return createLLM({ config: judgeConfig(process.env, { mock }), cache });
}

/** 给裁判和人看的卡：去掉对判断没用的字段 */
export function cardForJudge(state) {
  if (!state) return null;
  const slim = (x) => {
    const { source, popularity, ...rest } = x;
    return rest;
  };
  return {
    selfIntro: state.selfIntro,
    lookingFor: state.lookingFor,
    interests: state.interests.map(slim),
    situations: state.situations.map(slim),
    skills: state.skills.map(slim),
    wantsToLearn: state.wantsToLearn,
    dislikes: state.dislikes,
    avoid: state.avoid,
    style: state.style,
    extra: state.extra,
  };
}

/**
 * 把一张卡拆成一条条可以单独判断的“说法”。key 稳定（字段 + 内容），人工标注和裁判靠它对齐。
 * @returns {{n:number, key:string, field:string, text:string}[]}
 */
export function claimsOf(state) {
  if (!state) return [];
  const out = [];
  const add = (field, text) => out.push({ n: out.length + 1, key: `${field}:${text}`, field, text });
  if (state.selfIntro) add("selfIntro", `一句话自述：「${state.selfIntro}」`);
  if (state.lookingFor) add("lookingFor", `想认识：「${state.lookingFor}」`);
  for (const i of state.interests || []) {
    add("interests", `兴趣：${categoryName(i.category)}${i.type ? ` / ${i.type}` : ""}${i.entity ? ` / ${i.entity}` : "（没有具体对象）"}，热度 ${i.level}/10${i.recentAt ? "，标了“最近”" : ""}`);
  }
  for (const s of state.situations || []) add("situations", `近况：${s.text}`);
  for (const s of state.skills || []) add("skills", `会的（有基础）：${s.name}`);
  for (const w of state.wantsToLearn || []) add("wantsToLearn", `想学（没基础）：${w}`);
  for (const d of state.dislikes || []) add("dislikes", `讨厌、可以吐槽：${d}`);
  for (const a of state.avoid || []) add("avoid", `不想被聊到：${a}`);
  return out;
}

function inputBlock(c, userText) {
  const kind = c.source === "chat_paste" ? "用户粘贴的聊天记录里本人发的消息（已脱敏，别人的消息已去掉）" : "用户在三问引导里的回答（已脱敏）";
  return `## ${kind}\n\n${userText}`;
}

const OUTPUT = {
  faithfulness: `只输出 json：
{"items": [{"n": 条目编号, "verdict": "ok" 或 "distorted" 或 "unsupported", "why": "不是 ok 时用一句话说明，ok 时留空"}],
 "missed": [{"what": "漏掉的内容", "quote": "用户原话", "major": true 或 false}]}
items 必须覆盖每一个编号，一条不多一条不少。没有遗漏时 missed 为空数组。`,
  tone: `只输出 json：
{"flags": {"cliche": {"hit": true 或 false, "quote": "卡上的原文，没命中留空"},
           "inflated": {"hit": ..., "quote": ...}, "relabeled": {...}, "resume": {...}, "generic_style": {...}, "lang_mismatch": {...}}}
六个键都要有。拿不准时判 false。`,
  privacy: `只输出 json：
{"violations": [{"field": "出问题的字段", "quote": "卡上的原文", "type": "never" 或 "boundary" 或 "not_shared" 或 "edge", "why": "一句话"}]}
没有问题时 violations 为空数组。只报卡上真实存在的内容，不要报用户原话里有、但卡上没有收的东西。`,
};

// ---------- 分数：由代码按固定规则算，不由裁判给 ----------

export function scoreFaithfulness(items, missed) {
  const n = items.length;
  const u = items.filter((x) => x.verdict === "unsupported").length;
  const d = items.filter((x) => x.verdict === "distorted").length;
  const major = missed.filter((x) => x.major).length;
  const minor = missed.length - major;
  if (n > 0 && u / n > 0.5) return 1;
  if (u >= 2) return 2;
  if (u === 1 || major >= 1) return 3;
  if (d + minor >= 2) return 3;
  if (d + minor === 1) return 4;
  return 5;
}

export const TONE_FLAGS = {
  cliche: { name: "套话、营销腔", serious: true },
  inflated: { name: "拔高或改了性格", serious: true },
  relabeled: { name: "把用户的词换成了书面标签", serious: false },
  resume: { name: "像简历或填表", serious: false },
  generic_style: { name: "说话风格的描述空泛", serious: false },
  lang_mismatch: { name: "语言和用户不一致", serious: false },
};

export function scoreTone(hits) {
  const serious = hits.filter((k) => TONE_FLAGS[k]?.serious).length;
  const minor = hits.length - serious;
  if (serious >= 2) return 1;
  if (serious === 1) return 2;
  if (minor >= 2) return 3;
  if (minor === 1) return 4;
  return 5;
}

export function scorePrivacy(violations) {
  const count = (t) => violations.filter((v) => v.type === t).length;
  if (count("never") >= 2) return 1;
  if (count("never") === 1 || count("boundary") >= 1) return 2;
  if (count("not_shared") >= 1) return 3;
  if (count("edge") >= 1) return 4;
  return 5;
}

// ---------- 调用 ----------

async function ask(judge, dim, c, gen, extra) {
  const system = `你是 SocialQ 的评测员，负责检查 AI 从用户原话生成的“分身卡”。你只评一个维度。你不打分，只按下面的标准逐条判断；判断要有原文依据，拿不准时按标准里写的默认值处理。

${rubric(dim)}

${OUTPUT[dim]}`;
  const user = `${inputBlock(c, gen.userText)}

## 生成的分身卡

\`\`\`json
${JSON.stringify(cardForJudge(gen.state), null, 2)}
\`\`\`${extra ? `\n\n${extra}` : ""}`;
  const res = await judge.chat({
    tag: `eval_judge_${dim}`,
    json: true,
    temperature: 0,
    maxTokens: 1200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res;
}

/**
 * 维度 dim 的裁判。
 * @returns {{ score:number|null, reason:string, issues:{field,quote,problem}[], detail:object }}
 *   detail：faithfulness {items:[{n,key,field,text,verdict,why}], missed:[]}；tone {hits:[]}；privacy {violations:[]}
 */
export async function judgeOne(judge, dim, c, gen, { mockChecks = [] } = {}) {
  if (!gen.state) return { score: null, issues: [], reason: "没有生成出卡", detail: null };
  const claims = claimsOf(gen.state);
  if (judge.isMock) {
    // 演示模式：用代码检查的结果近似，只为让流程跑通，不代表质量
    const failed = mockChecks.filter((x) => x.dim === dim && !x.pass);
    const score = failed.some((x) => x.severity === "hard") ? 2 : failed.length ? 4 : 5;
    const detail = dim === "faithfulness" ? { items: claims.map((x) => ({ ...x, verdict: "ok", why: "" })), missed: [] } : dim === "tone" ? { hits: [] } : { violations: [] };
    return { score, issues: failed.map((x) => ({ field: x.id, quote: "", problem: x.detail })), reason: "（演示模式，由代码检查近似）", detail, mock: true };
  }
  try {
    if (dim === "faithfulness") {
      const list = claims.map((x) => `${x.n}. ${x.text}`).join("\n") || "（卡是空的，没有条目）";
      const res = await ask(judge, dim, c, gen, `## 需要逐条判断的条目\n\n${list}`);
      const byN = new Map((Array.isArray(res.json?.items) ? res.json.items : []).map((x) => [Number(x?.n), x]));
      const items = claims.map((x) => {
        const v = byN.get(x.n);
        const verdict = ["ok", "distorted", "unsupported"].includes(v?.verdict) ? v.verdict : null;
        return { ...x, verdict, why: String(v?.why || "").slice(0, 120) };
      });
      // 裁判漏判的条目不能当成 ok：整条维度记为无效，报告里会单独数出来
      if (items.some((x) => !x.verdict)) return { score: null, issues: [], reason: "", detail: { items, missed: [] }, error: "裁判没有覆盖所有条目" };
      const missed = (Array.isArray(res.json?.missed) ? res.json.missed : []).slice(0, 8).map((m) => ({ what: String(m?.what || "").slice(0, 60), quote: String(m?.quote || "").slice(0, 60), major: Boolean(m?.major) }));
      const bad = items.filter((x) => x.verdict !== "ok");
      return {
        score: scoreFaithfulness(items, missed),
        reason: [bad.length ? `${bad.length} 条有问题` : "", missed.length ? `漏了 ${missed.length} 处` : ""].filter(Boolean).join("，") || "逐条都对得上",
        issues: [
          ...bad.map((x) => ({ field: x.field, quote: x.text, problem: `${x.verdict === "unsupported" ? "没有依据" : "走样"}：${x.why}` })),
          ...missed.map((m) => ({ field: "遗漏", quote: m.quote, problem: `${m.major ? "重要" : "次要"}：${m.what}` })),
        ],
        detail: { items, missed },
        usage: res.usage,
      };
    }
    if (dim === "tone") {
      const res = await ask(judge, dim, c, gen);
      const flags = res.json?.flags || {};
      const hits = Object.keys(TONE_FLAGS).filter((k) => flags[k]?.hit === true);
      return {
        score: scoreTone(hits),
        reason: hits.length ? hits.map((k) => TONE_FLAGS[k].name).join("、") : "没有命中任何一项",
        issues: hits.map((k) => ({ field: k, quote: String(flags[k]?.quote || "").slice(0, 80), problem: TONE_FLAGS[k].name })),
        detail: { hits },
        usage: res.usage,
      };
    }
    const res = await ask(judge, dim, c, gen);
    const violations = (Array.isArray(res.json?.violations) ? res.json.violations : [])
      .slice(0, 8)
      .map((v) => ({ field: String(v?.field || ""), quote: String(v?.quote || "").slice(0, 80), type: ["never", "boundary", "not_shared", "edge"].includes(v?.type) ? v.type : "edge", why: String(v?.why || "").slice(0, 120) }));
    return {
      score: scorePrivacy(violations),
      reason: violations.length ? violations.map((v) => `${v.type}:${v.quote}`).join("；") : "没有违规项",
      issues: violations.map((v) => ({ field: v.field, quote: v.quote, problem: `${v.type}：${v.why}` })),
      detail: { violations },
      usage: res.usage,
    };
  } catch (error) {
    return { score: null, issues: [], reason: "", detail: null, error: error.message };
  }
}

/**
 * 两两比较：同一份输入、两张卡，问裁判哪张更好。为抵消位置偏差，正反各问一次；两次结论不一致记为平局。
 * 返回 "A" | "B" | "tie"
 */
export async function pairwise(judge, c, userText, stateA, stateB) {
  if (!stateA || !stateB) return { winner: !stateA && !stateB ? "tie" : stateA ? "A" : "B", reason: "一方没有生成出卡" };
  if (judge.isMock) return { winner: "tie", reason: "（演示模式）" };
  const system = `你是 SocialQ 的评测员。同一位用户的同一份原话，生成了两张“分身卡”。综合下面三个标准，判断哪张更好：

1. 忠实：不编造、不推断过度、不漏掉用户明确说过的具体对象（最重要）
2. 隐私：不含敏感信息和他人信息，不该对外的不对外
3. 语气：selfIntro、lookingFor、style 像本人说的话，不油腻

只输出 json：{"winner": "1" 或 "2" 或 "tie", "reason": "一两句话"}
两张差不多时选 tie，不要为了分出胜负硬选。`;
  const askPair = async (first, second) => {
    const res = await judge.chat({
      tag: "eval_pairwise",
      json: true,
      temperature: 0,
      maxTokens: 300,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `${inputBlock(c, userText)}\n\n## 卡 1\n\n\`\`\`json\n${JSON.stringify(cardForJudge(first), null, 2)}\n\`\`\`\n\n## 卡 2\n\n\`\`\`json\n${JSON.stringify(cardForJudge(second), null, 2)}\n\`\`\``,
        },
      ],
    });
    return { w: String(res.json?.winner || "tie"), reason: String(res.json?.reason || "") };
  };
  const r1 = await askPair(stateA, stateB);
  const r2 = await askPair(stateB, stateA);
  const v1 = r1.w === "1" ? "A" : r1.w === "2" ? "B" : "tie";
  const v2 = r2.w === "1" ? "B" : r2.w === "2" ? "A" : "tie";
  return { winner: v1 === v2 ? v1 : "tie", reason: v1 === v2 ? r1.reason : `正反两次结论不一致（${v1} / ${v2}）` };
}
