"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RadarChart, ModeBadge, STORE, saveSession, loadSession } from "./components";

const loadingLines = [
  "正在过滤对方发的消息，只保留你本人的...",
  "正在给手机号、邮箱、QQ 号打码...",
  "正在提取阴阳怪气浓度...",
  "正在分析深夜作息和宵夜偏好...",
  "正在为每项特质寻找原话证据...",
  "正在把混乱打磨成魅力...",
];

const SAMPLE_CHAT = `我：哈哈哈笑死 这个猫猫表情包绝了
阿杰：你又熬夜？
我：三点才睡 在赶毕设的代码 debug 到崩溃
我：为什么我的 bug 总在凌晨出现？？
阿杰：我手机号 13812345678 你存一下
我：周末要不要一起去吃火锅 走起
我：顺便把新出的那部科幻电影看了
我：说实话最近在补番 追番根本停不下来
我：王者上分又失败了 破防了 [狗头]
阿杰：哈哈哈
我：谢谢你上次帮我改简历 真的很有用
我：我的邮箱 zhangsan@example.com 你把文件发这个就行`;

export default function HomePage() {
  const router = useRouter();
  const [stage, setStage] = useState("intro");
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [nickname, setNickname] = useState("");
  const [chatText, setChatText] = useState("");
  const [result, setResult] = useState(null); // { persona, privacy, mode }
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const pending = useRef(false);

  // 回到首页时恢复上一次生成的人格卡
  useEffect(() => {
    const saved = loadSession(STORE.persona);
    if (saved?.persona) {
      setResult(saved);
      setStage("success");
    }
  }, []);

  useEffect(() => {
    if (stage !== "loading") return undefined;
    setProgress(8);
    setLineIndex(0);
    const lines = window.setInterval(() => setLineIndex((i) => Math.min(i + 1, loadingLines.length - 1)), 1100);
    const bar = window.setInterval(() => setProgress((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) / 8)) : p)), 400);
    return () => {
      window.clearInterval(lines);
      window.clearInterval(bar);
    };
  }, [stage]);

  async function generate() {
    if (pending.current) return;
    pending.current = true;
    setError("");
    setStage("loading");
    try {
      const res = await fetch("/api/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatText, nickname, consent, adult }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setProgress(100);
      setResult(data);
      saveSession(STORE.persona, data);
      setStage("success");
    } catch (e) {
      setError(e.message);
      setStage("input");
    } finally {
      pending.current = false;
    }
  }

  function removeInterest(name) {
    const next = { ...result, persona: { ...result.persona, interests: result.persona.interests.filter((i) => i.name !== name) } };
    setResult(next);
    saveSession(STORE.persona, next);
  }

  function resetFlow() {
    setResult(null);
    saveSession(STORE.persona, null);
    saveSession(STORE.matches, null);
    setStage("input");
  }

  const persona = result?.persona;
  const topTraits = persona ? [...persona.traits].sort((a, b) => b.score - a.score).slice(0, 3) : [];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e8fbff_0%,_#cfeeff_35%,_#f8c7a3_100%)] px-4 py-6 font-display text-ink">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-sm flex-col overflow-hidden rounded-[2.5rem] border border-white/70 bg-white/55 shadow-float backdrop-blur">
        <div className="relative overflow-hidden px-5 pb-6 pt-5">
          <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top,_rgba(116,211,255,0.95),_rgba(255,255,255,0))]" />

          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-slate-500">SocialQ 实验室</p>
              <h1 className="mt-2 text-3xl font-black leading-none text-slate-900">生成我的claw</h1>
            </div>
            <div className="animate-bob rounded-[1.4rem] bg-white px-4 py-3 text-3xl shadow-lg">🐾</div>
          </div>

          <div className="relative mt-6 rounded-[2rem] bg-[#fff9ee] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            {stage === "intro" && (
              <section className="space-y-4">
                <div className="rounded-[1.6rem] bg-gradient-to-br from-qqBlue via-qqSky to-qqMint p-[1px]">
                  <div className="rounded-[1.55rem] bg-slate-950/95 p-4 text-[#d8fff4]">
                    <p className="text-xs uppercase tracking-[0.28em] text-[#7cdac8]">它会做什么</p>
                    <p className="mt-3 text-sm leading-6">
                      读一段你自己发过的 QQ 消息，提炼你的社交人格，孵化一只替你先去“破冰”的 AI 分身。
                    </p>
                  </div>
                </div>

                <ul className="space-y-2 rounded-[1.6rem] bg-white p-4 text-[13px] leading-6 text-slate-600 shadow-sm">
                  <li>🔒 只分析<b>你本人</b>发出的消息，对方的消息会被丢弃</li>
                  <li>🙈 手机号、邮箱、QQ 号等在发给 AI 之前自动打码</li>
                  <li>🧾 原始聊天不保存；人格卡的每一项都附原话证据，可删除</li>
                  <li>🤖 分身聊天全程标注“AI 代理”，由你决定要不要真人接管</li>
                  <li>🔞 仅限年满 18 岁的用户使用</li>
                </ul>

                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                  <span>我已年满 18 岁</span>
                </label>
                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>我同意以上分析方式，并只会提供我自己的聊天内容</span>
                </label>

                <button
                  type="button"
                  disabled={!adult || !consent}
                  onClick={() => setStage("input")}
                  className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-5 text-lg font-black text-white shadow-lg transition-transform duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  开始授权
                </button>
              </section>
            )}

            {stage === "input" && (
              <section className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">你在聊天记录里的名字（可选）</label>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="例如：小赵；不填则识别“我：”开头的消息"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-qqBlue"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">粘贴聊天记录</label>
                    <button type="button" onClick={() => setChatText(SAMPLE_CHAT)} className="text-xs font-bold text-qqBlue">
                      填入示例
                    </button>
                  </div>
                  <textarea
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    rows={9}
                    placeholder={"支持“我：内容”格式或 QQ 导出的聊天记录\n对方的消息会被自动过滤"}
                    className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-qqBlue"
                  />
                </div>
                {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
                <button
                  type="button"
                  disabled={chatText.trim().length < 20}
                  onClick={generate}
                  className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-5 text-lg font-black text-white shadow-lg transition-transform duration-200 active:scale-[0.98] disabled:opacity-40"
                >
                  生成我的claw
                </button>
              </section>
            )}

            {stage === "loading" && (
              <section className="space-y-5">
                <div className="rounded-[1.7rem] bg-slate-950 p-4 text-[#9dffd9] shadow-lg">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[#66d7be]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff7b72]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ffd66b]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#51d88a]" />
                    <span className="ml-2">claw终端</span>
                  </div>
                  <div className="mt-4 space-y-2 font-mono text-sm">
                    {loadingLines.slice(0, lineIndex + 1).map((line) => (
                      <p key={line} className="leading-6">
                        <span className="mr-2 text-[#66d7be]">&gt;</span>
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="rounded-[1.6rem] bg-white p-4">
                  <div className="flex items-center justify-between text-sm font-bold text-slate-600">
                    <span>正在编译你的claw...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="mt-3 h-4 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,_#12a4ff,_#74d3ff,_#8de7c8,_#12a4ff)] bg-[length:200%_100%] transition-all duration-500 ease-out animate-shimmer"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </section>
            )}

            {stage === "success" && persona && (
              <section className="space-y-5">
                <div className="rounded-[1.8rem] bg-gradient-to-br from-white to-[#eef9ff] p-5 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-[#d9f5ff] px-3 py-2 text-2xl">✨</div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.28em] text-slate-500">生成成功</p>
                      <h2 className="text-2xl font-black text-slate-900">你的claw已上线</h2>
                    </div>
                  </div>
                  <div className="mt-3">
                    <ModeBadge mode={result.mode} />
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">{persona.summary}</p>

                  {persona.interests.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {persona.interests.map((i) => (
                        <button
                          key={i.name}
                          type="button"
                          onClick={() => removeInterest(i.name)}
                          title="点击删除这个标签"
                          className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700"
                        >
                          {i.name} ✕
                        </button>
                      ))}
                    </div>
                  )}

                  <dl className="mt-4 space-y-1 text-[13px] leading-6 text-slate-600">
                    <div><dt className="inline font-bold text-slate-700">说话风格：</dt><dd className="inline">{persona.style}</dd></div>
                    <div><dt className="inline font-bold text-slate-700">作息：</dt><dd className="inline">{persona.schedule}</dd></div>
                    <div><dt className="inline font-bold text-slate-700">想认识：</dt><dd className="inline">{persona.lookingFor}</dd></div>
                  </dl>

                  <div className="mt-4 aspect-square w-full">
                    <RadarChart traits={persona.traits} />
                  </div>

                  <details className="mt-3 rounded-2xl bg-white/80 p-3 text-[13px] text-slate-600">
                    <summary className="cursor-pointer font-bold text-slate-700">每项分数的原话证据</summary>
                    <ul className="mt-2 space-y-1">
                      {persona.traits.map((t) => (
                        <li key={t.label}>
                          <b>{t.label} {t.score}</b>：{t.evidence}
                        </li>
                      ))}
                    </ul>
                  </details>

                  {result.privacy && (
                    <p className="mt-3 text-[11px] leading-5 text-slate-400">
                      隐私处理：保留你本人的消息 {result.privacy.keptCount} 条，丢弃他人消息 {result.privacy.droppedCount} 条，
                      打码 {Object.values(result.privacy.redactions || {}).reduce((a, b) => a + b, 0)} 处。
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => router.push("/mixer")}
                  className="block w-full rounded-[1.7rem] bg-gradient-to-r from-[#ff996e] to-[#ffd66b] px-5 py-5 text-center text-lg font-black text-slate-900 shadow-lg transition-transform duration-200 active:scale-[0.98]"
                >
                  放我的claw去社交
                </button>

                <button
                  type="button"
                  onClick={resetFlow}
                  className="w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500"
                >
                  重新生成
                </button>
              </section>
            )}
          </div>

          {topTraits.length > 0 && (
            <div className="relative mt-5 grid grid-cols-3 gap-3 text-center text-xs font-bold text-slate-600">
              {topTraits.map((t) => (
                <div key={t.label} className="rounded-[1.4rem] bg-white/80 px-3 py-3">
                  {t.score}
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">{t.label}</p>
                </div>
              ))}
            </div>
          )}

          <Link href="/lab" className="relative mt-5 block text-center text-xs font-bold text-slate-500 underline-offset-4 hover:underline">
            我们怎么验证匹配靠不靠谱 →
          </Link>
        </div>
      </div>
    </main>
  );
}
