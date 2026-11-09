// LLM 裁判：按 rubrics/ 下的评分标准，对每张卡在三个维度上分别打 1-5 分。
// 每个维度单独调用一次，温度 0，结果走磁盘缓存（卡和 rubric 不变就不重复花钱）。
// 裁判模型可以和生成模型不同：设置 JUDGE_MODEL / JUDGE_BASE_URL / JUDGE_API_KEY，没设就用 LLM_*。

import fs from "node:fs";
import path from "node:path";
import { createLLM, getLLMConfig } from "../../../lib/llm.mjs";
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

/** 给裁判看的卡：去掉对评分没用的字段 */
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

function inputBlock(c, userText) {
  const kind = c.source === "chat_paste" ? "用户粘贴的聊天记录里本人发的消息（已脱敏，别人的消息已去掉）" : "用户在三问引导里的回答（已脱敏）";
  return `## ${kind}\n\n${userText}`;
}

const OUTPUT = `只输出 json：{"score": 1-5 的整数, "issues": [{"field": "出问题的字段", "quote": "卡上的原文", "problem": "一句话说明"}], "reason": "一两句话总结为什么给这个分"}
没有问题时 issues 为空数组。先逐条检查，再给分；分数必须和 rubric 的标准一致。`;

/** 维度 dim 的裁判。返回 { score, issues, reason } 或 { error } */
export async function judgeOne(judge, dim, c, gen, { mockChecks = [] } = {}) {
  if (!gen.state) return { score: null, issues: [], reason: "没有生成出卡" };
  if (judge.isMock) {
    // 演示模式：用代码检查的结果近似一个分数，只为让流程跑通，不代表质量
    const failed = mockChecks.filter((x) => x.dim === dim && !x.pass);
    const score = failed.some((x) => x.severity === "hard") ? 2 : failed.length ? 4 : 5;
    return { score, issues: failed.map((x) => ({ field: x.id, quote: "", problem: x.detail })), reason: "（演示模式，分数由代码检查近似）", mock: true };
  }
  const system = `你是 SocialQ 的评测员，负责检查 AI 从用户原话生成的“分身卡”。你只评一个维度，严格按下面的 rubric 打分，不受其他维度影响。

${rubric(dim)}

${OUTPUT}`;
  const user = `${inputBlock(c, gen.userText)}

## 生成的分身卡

\`\`\`json
${JSON.stringify(cardForJudge(gen.state), null, 2)}
\`\`\``;
  try {
    const res = await judge.chat({
      tag: `eval_judge_${dim}`,
      json: true,
      temperature: 0,
      maxTokens: 800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const j = res.json || {};
    const score = Math.round(Number(j.score));
    return {
      score: score >= 1 && score <= 5 ? score : null,
      issues: Array.isArray(j.issues) ? j.issues.slice(0, 8) : [],
      reason: String(j.reason || "").slice(0, 300),
      usage: res.usage,
    };
  } catch (error) {
    return { score: null, issues: [], reason: "", error: error.message };
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

${"只输出 json："}{"winner": "1" 或 "2" 或 "tie", "reason": "一两句话"}
两张差不多时选 tie，不要为了分出胜负硬选。`;
  const ask = async (first, second) => {
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
  const r1 = await ask(stateA, stateB);
  const r2 = await ask(stateB, stateA);
  const v1 = r1.w === "1" ? "A" : r1.w === "2" ? "B" : "tie";
  const v2 = r2.w === "1" ? "B" : r2.w === "2" ? "A" : "tie";
  return { winner: v1 === v2 ? v1 : "tie", reason: v1 === v2 ? r1.reason : `正反两次结论不一致（${v1} / ${v2}）` };
}
