import { NextResponse } from "next/server";
import { createLLM, getLLMConfig } from "@/lib/llm.mjs";
import { extractPersona } from "@/lib/agents.mjs";
import { prepareChatForLLM } from "@/lib/privacy.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }
  const { chatText = "", nickname = "", consent, adult } = body || {};
  if (!consent || !adult) {
    return NextResponse.json({ error: "需要确认已年满 18 岁并同意分析说明" }, { status: 400 });
  }
  if (String(chatText).trim().length < 20) {
    return NextResponse.json({ error: "聊天内容太少了，至少粘贴几句你自己发过的话" }, { status: 400 });
  }

  // 原始聊天只在内存里处理：先过滤他人消息、再脱敏，之后才发给模型；不落盘、不打日志
  const prepared = prepareChatForLLM(chatText, [String(nickname).trim()]);
  if (!prepared.report.keptCount) {
    return NextResponse.json(
      { error: "没有识别到你本人发的消息。请用“我：内容”的格式，或在昵称里填你在聊天记录里的名字。" },
      { status: 400 }
    );
  }

  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { persona } = await extractPersona(llm, prepared.text, { nickname: String(nickname).trim() || undefined });
    return NextResponse.json({ persona, privacy: prepared.report, mode: llm.isMock ? "demo" : "live" });
  } catch (error) {
    console.error("persona error:", error.message);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}
