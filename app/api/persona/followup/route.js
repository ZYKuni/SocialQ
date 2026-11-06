import { NextResponse } from "next/server";
import { createLLM, getLLMConfig } from "@/lib/llm.mjs";
import { decideFollowup } from "@/lib/agents.mjs";
import { redact } from "@/lib/privacy.mjs";

export const runtime = "nodejs";
export const maxDuration = 30;

// 三问引导：判断要不要追问一句。出错时直接进入下一题，不让用户卡住。
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }
  const { question, answer = "", askedFollowup = false } = body || {};
  try {
    const llm = createLLM({ config: getLLMConfig() });
    const { action, text } = await decideFollowup(llm, {
      question: Number(question),
      answer: redact(String(answer).slice(0, 300)).text,
      askedFollowup: Boolean(askedFollowup),
    });
    return NextResponse.json({ action, text, mode: llm.isMock ? "demo" : "live" });
  } catch (error) {
    console.error("followup error:", error.message);
    return NextResponse.json({ action: "next", text: "" });
  }
}
