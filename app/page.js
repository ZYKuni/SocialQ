"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RadarChart, ModeBadge, STORE, saveSession, loadSession } from "./components";
import { GuidedChat, QuickPicker, ConfirmView } from "./persona-ui";
import { buildCard, buildQuickState, categoryName, todayISO, SHARED } from "@/lib/socialState.mjs";

const loadingLines = [
  "正在整理你说过的话...",
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

const evidenced = (traits = []) => traits.filter((t) => t.evidence && t.evidence !== "证据不足" && !t.evidence.startsWith("（"));

export default function HomePage() {
  const router = useRouter();
  const [stage, setStage] = useState("intro");
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [nickname, setNickname] = useState("");
  const [chatText, setChatText] = useState("");
  const [result, setResult] = useState(null); // { persona, mode, privacy?, added? }
  const [answers, setAnswers] = useState([]); // 三问的回答，卡不够用时补一句再抽一次
  const [more, setMore] = useState("");
  const [upgradeFrom, setUpgradeFrom] = useState(null); // 从速通卡升级时的旧卡
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const pending = useRef(false);

  // 回到首页时恢复上一次的卡
  useEffect(() => {
    const saved = loadSession(STORE.persona);
    const p = saved?.persona;
    if (!p) return;
    setResult(saved);
    setAdult(true);
    setConsent(true);
    if (p.cardVersion !== 2) setStage("done");
    else if (p.tier === "quick") setStage("quickDone");
    else setStage(p.confirmedAt ? "done" : "confirm");
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

  function keep(data) {
    setResult(data);
    saveSession(STORE.persona, data);
    saveSession(STORE.matches, null);
  }

  async function callPersona(body, { onOk, backTo }) {
    if (pending.current) return;
    pending.current = true;
    setError("");
    setStage("loading");
    try {
      const res = await fetch("/api/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, nickname, consent, adult }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setProgress(100);
      onOk(data);
    } catch (e) {
      setError(e.message);
      setStage(backTo);
    } finally {
      pending.current = false;
    }
  }

  function generateGuided(list) {
    setAnswers(list);
    callPersona(
      { mode: "guided", answers: list },
      {
        backTo: "closing",
        onOk: (data) => {
          let persona = data.persona;
          // 从速通卡升级：沿用旧卡的 id，版本号加 1
          if (upgradeFrom) persona = buildCard({ ...persona, id: upgradeFrom.id, version: (upgradeFrom.version || 1) + 1 });
          keep({ ...data, persona });
          setStage("closing");
        },
      }
    );
  }

  function addMore() {
    const text = more.trim();
    if (!text) return;
    setMore("");
    generateGuided([...answers, { question: 1, answer: text }]);
  }

  function pasteChat() {
    callPersona(
      { mode: "paste", chatText, persona: result.persona },
      {
        backTo: "paste",
        onOk: (data) => {
          keep(data);
          setChatText("");
          setStage("confirm");
        },
      }
    );
  }

  // 旧版：直接粘贴生成（没有 v2 卡时保留，兼容以前的入口）
  function generateLegacy() {
    callPersona(
      { chatText },
      {
        backTo: "paste",
        onOk: (data) => {
          keep(data);
          setStage("done");
        },
      }
    );
  }

  function startQuick(selection) {
    const state = buildQuickState(selection);
    const persona = buildCard({ state, tier: "quick", source: "quick", name: nickname.trim() || "我的claw", confirmedAt: todayISO() });
    keep({ persona, mode: null });
    router.push("/mixer");
  }

  function startUpgrade() {
    const p = result?.persona;
    setUpgradeFrom(p);
    setStage("guided");
  }

  function resetFlow() {
    setResult(null);
    setAnswers([]);
    setUpgradeFrom(null);
    saveSession(STORE.persona, null);
    saveSession(STORE.matches, null);
    saveSession(STORE.onboarding, null);
    setStage("intro");
  }

  function removeLegacyInterest(name) {
    keep({ ...result, persona: { ...result.persona, interests: result.persona.interests.filter((i) => i.name !== name) } });
  }

  const persona = result?.persona;
  const isV2 = persona?.cardVersion === 2;
  const showRadar = persona && (!isV2 || evidenced(persona.traits).length >= 3);
  const topTraits = showRadar && stage === "done" ? [...persona.traits].sort((a, b) => b.score - a.score).slice(0, 3) : [];
  const upgradeChips = upgradeFrom?.state ? [...new Set(upgradeFrom.state.interests.map((i) => i.type || categoryName(i.category)))].slice(0, 4) : [];

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
                    <p className="mt-3 text-sm leading-6">回答 3 个小问题，造一个替你开口的 AI 分身。它先替你去“破冰”，聊得来再由你接管。</p>
                  </div>
                </div>

                <ul className="space-y-2 rounded-[1.6rem] bg-white p-4 text-[13px] leading-6 text-slate-600 shadow-sm">
                  <li>🧾 每一项都附你说过的原话，你决定哪些能给别人看</li>
                  <li>🔒 贴聊天记录是可选的：只分析<b>你本人</b>的消息，手机号等自动打码，原文不保存</li>
                  <li>🤖 分身聊天全程标注“AI 代理”，由你决定要不要真人接管</li>
                  <li>🔞 仅限年满 18 岁的用户使用</li>
                </ul>

                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                  <span>我已年满 18 岁</span>
                </label>
                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>我同意以上方式，并只会提供我自己的内容</span>
                </label>

                <button
                  type="button"
                  disabled={!adult || !consent}
                  onClick={() => {
                    setUpgradeFrom(null);
                    setStage("guided");
                  }}
                  className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-5 text-lg font-black text-white shadow-lg transition-transform duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  聊 3 个问题，造一个像你的分身
                </button>
                <button
                  type="button"
                  disabled={!adult || !consent}
                  onClick={() => setStage("quick")}
                  className="w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 disabled:opacity-40"
                >
                  先随便点点，直接看效果
                </button>
              </section>
            )}

            {stage === "guided" && <GuidedChat onDone={generateGuided} extraChips={upgradeChips} />}

            {stage === "quick" && <QuickPicker onDone={startQuick} onBack={() => setStage("intro")} />}

            {stage === "closing" && persona && (
              <section className="space-y-4">
                <p className="rounded-[1.2rem] bg-white px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm">
                  好了，这些够你的分身先去打个招呼了。
                </p>
                {persona.thin && (
                  <div className="space-y-2 rounded-2xl bg-sky-50 p-3">
                    <p className="text-xs leading-5 text-sky-700">再说一个你最近在玩/在看的，分身开场会自然很多。</p>
                    <div className="flex gap-2">
                      <input
                        value={more}
                        onChange={(e) => setMore(e.target.value)}
                        placeholder="比如一部剧、一款游戏、一个乐队"
                        maxLength={100}
                        className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-qqBlue"
                      />
                      <button type="button" disabled={!more.trim()} onClick={addMore} className="shrink-0 whitespace-nowrap rounded-2xl bg-qqBlue px-3 py-2 text-xs font-black text-white disabled:opacity-40">
                        补上
                      </button>
                    </div>
                  </div>
                )}
                {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
                <button type="button" onClick={() => setStage("confirm")} className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-4 text-base font-black text-white shadow-lg">
                  {persona.thin ? "先这样吧，看看我的卡" : "看看我的卡"}
                </button>
                <button type="button" onClick={() => setStage("paste")} className="w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500">
                  贴聊天记录让它更像我
                </button>
              </section>
            )}

            {stage === "paste" && (
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
                    placeholder={"支持“我：内容”格式或 QQ 导出的聊天记录\n对方的消息会被自动过滤，原文不保存"}
                    className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-qqBlue"
                  />
                </div>
                {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
                <button
                  type="button"
                  disabled={chatText.trim().length < 20}
                  onClick={isV2 ? pasteChat : generateLegacy}
                  className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-5 text-lg font-black text-white shadow-lg transition-transform duration-200 active:scale-[0.98] disabled:opacity-40"
                >
                  分析
                </button>
                {isV2 && (
                  <button type="button" onClick={() => setStage(persona.confirmedAt ? "done" : "confirm")} className="w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500">
                    不贴了
                  </button>
                )}
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

            {stage === "confirm" && isV2 && (
              <>
                {result.privacy && (
                  <p className="mb-3 text-[11px] leading-5 text-slate-400">
                    隐私处理：保留你本人的消息 {result.privacy.keptCount} 条，丢弃他人消息 {result.privacy.droppedCount} 条，打码{" "}
                    {Object.values(result.privacy.redactions || {}).reduce((a, b) => a + b, 0)} 处。
                    {result.privacy.fewMessages ? "内容有点少，这次只找兴趣和近况。" : ""}
                  </p>
                )}
                <ConfirmView
                  persona={persona}
                  onChange={(p) => keep({ ...result, persona: p })}
                  onConfirm={(p) => {
                    keep({ ...result, persona: p, privacy: undefined });
                    setStage("done");
                  }}
                  onPaste={() => setStage("paste")}
                />
              </>
            )}

            {stage === "quickDone" && persona && (
              <section className="space-y-4">
                <p className="text-sm font-black text-slate-800">你在用速通卡</p>
                <p className="text-xs leading-5 text-slate-500">
                  你的分身只知道你喜欢{persona.state.interests.map((i) => i.entity || i.type || categoryName(i.category)).slice(0, 4).join("、")}
                  。聊 3 个问题，它就能说出具体的了。
                </p>
                <button type="button" onClick={startUpgrade} className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-4 text-base font-black text-white shadow-lg">
                  让分身更像我（约 1 分钟）
                </button>
                <button type="button" onClick={() => router.push("/mixer")} className="w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
                  继续去社交
                </button>
                <button type="button" onClick={resetFlow} className="w-full text-xs font-bold text-slate-400">
                  重新开始
                </button>
              </section>
            )}

            {stage === "done" && persona && (
              <section className="space-y-5">
                <div className="rounded-[1.8rem] bg-gradient-to-br from-white to-[#eef9ff] p-5 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-[#d9f5ff] px-3 py-2 text-2xl">✨</div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.28em] text-slate-500">{isV2 ? "别人匹配后会看到" : "生成成功"}</p>
                      <h2 className="text-2xl font-black text-slate-900">你的claw已上线</h2>
                    </div>
                  </div>
                  <div className="mt-3">
                    <ModeBadge mode={result.mode} />
                  </div>

                  {persona.summary && <p className="mt-4 text-sm leading-6 text-slate-600">{persona.summary}</p>}

                  {isV2 ? (
                    <ul className="mt-4 space-y-2">
                      {persona.state.interests
                        .filter((i) => SHARED.has(i.disclosure))
                        .map((i, k) => (
                          <li key={k} className="rounded-2xl bg-white/80 px-3 py-2 text-[13px] text-slate-700">
                            <b>{i.entity || i.type || categoryName(i.category)}</b>
                            <span className="ml-2 text-xs text-slate-400">“{i.evidence}”</span>
                          </li>
                        ))}
                      {persona.state.situations
                        .filter((s) => SHARED.has(s.disclosure))
                        .map((s, k) => (
                          <li key={`s${k}`} className="rounded-2xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                            近况：{s.text}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    persona.interests.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {persona.interests.map((i) => (
                          <button
                            key={i.name}
                            type="button"
                            onClick={() => removeLegacyInterest(i.name)}
                            title="点击删除这个标签"
                            className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700"
                          >
                            {i.name} ✕
                          </button>
                        ))}
                      </div>
                    )
                  )}

                  <dl className="mt-4 space-y-1 text-[13px] leading-6 text-slate-600">
                    {!isV2 && persona.style && persona.style !== "未知" && (
                      <div><dt className="inline font-bold text-slate-700">说话风格：</dt><dd className="inline">{persona.style}</dd></div>
                    )}
                    {!isV2 && (
                      <div><dt className="inline font-bold text-slate-700">作息：</dt><dd className="inline">{persona.schedule}</dd></div>
                    )}
                    {persona.lookingFor && persona.lookingFor !== "未知" && (
                      <div><dt className="inline font-bold text-slate-700">想认识：</dt><dd className="inline">{persona.lookingFor}</dd></div>
                    )}
                  </dl>

                  {showRadar && (
                    <>
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
                    </>
                  )}

                  {!isV2 && result.privacy && (
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
                  让分身出发
                </button>

                {isV2 && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setStage("confirm")} className="flex-1 rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500">
                      改一改
                    </button>
                    <button type="button" onClick={() => setStage("paste")} className="flex-1 rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500">
                      贴聊天记录
                    </button>
                  </div>
                )}

                <button type="button" onClick={resetFlow} className="w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500">
                  重新开始
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
