// 按线上接口（app/api/persona/route.js）的同一条路径生成人格卡，评测测的就是用户实际拿到的东西。
// 线上改了生成流程，这里要跟着改。

import { extractState } from "../../../lib/agents.mjs";
import { validateState, buildCard } from "../../../lib/socialState.mjs";
import { prepareChatForLLM, redact } from "../../../lib/privacy.mjs";
import { CONFIG } from "./util.mjs";

const WITH_TRAITS_MIN = 20; // 和 route.js 保持一致

/** 用例 → 模型实际看到的用户原话（已脱敏） */
export function prepareInput(c) {
  if (c.source === "chat_paste") {
    const prepared = prepareChatForLLM(c.chatText || "", c.selfNames || []);
    return { userText: prepared.text, privacy: prepared.report, withTraits: prepared.report.keptCount >= WITH_TRAITS_MIN };
  }
  const lines = (c.answers || [])
    .flatMap((a) => [a?.answer, a?.followupAnswer])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => t.slice(0, CONFIG.maxAnswerChars));
  const r = redact(lines.join("\n"));
  return { userText: r.text, privacy: { redactions: r.counts }, withTraits: false };
}

/** 跑一遍生成。不抛异常：模型出错、JSON 解析失败都记在 error 里，算格式失败。 */
export async function generate(llm, c, { today = CONFIG.today } = {}) {
  const day = c.today || today;
  const source = c.source === "chat_paste" ? "chat_paste" : "guided";
  const { userText, privacy, withTraits } = prepareInput(c);
  const started = Date.now();
  if (!userText.trim()) {
    return { userText, privacy, raw: null, state: null, card: null, dropped: [], error: "没有本人原话，接口会直接拒绝（400）", latencyMs: 0, usage: null };
  }
  try {
    const { raw, usage } = await extractState(llm, userText, { source, today: day, withTraits });
    const { state, dropped } = validateState(raw, { userText, source, today: day });
    if (source === "chat_paste" && !withTraits) state.style = null;
    const card = buildCard({ state, tier: "full", source, name: "评测", id: c.id, today: day });
    return { userText, privacy, raw, state, card, dropped, error: null, latencyMs: Date.now() - started, usage };
  } catch (error) {
    return { userText, privacy, raw: null, state: null, card: null, dropped: [], error: error.message, latencyMs: Date.now() - started, usage: null };
  }
}
