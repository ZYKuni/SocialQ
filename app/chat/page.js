"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ModeBadge, TierBadge, UpgradeHint, STORE, loadSession, saveSession } from "../components";
import { GapAsk } from "../gap-ui";

function ChatBubble({ message, humanMode, names }) {
  const isHuman = message.speaker === "ME";
  const isMine = message.speaker === "A" || isHuman;
  const label = isHuman ? "我（真人）" : message.speaker === "A" ? `${names.me}的claw` : `${names.other}的claw`;
  const bubble = isMine
    ? "bg-[linear-gradient(135deg,_#12a4ff,_#74d3ff)] text-white shadow-[0_14px_30px_rgba(18,164,255,0.28)]"
    : "bg-[linear-gradient(135deg,_#eef4ff,_#dce9ff)] text-slate-800 shadow-[0_14px_30px_rgba(74,109,255,0.14)]";
  const chip = isMine ? "bg-cyan-500/15 text-cyan-700 border-cyan-200/70" : "bg-violet-500/10 text-violet-700 border-violet-200/70";
  const showAgentMarks = !humanMode && !isHuman;

  return (
    <div className={`flex w-full ${isMine ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[88%] items-end gap-2 ${isMine ? "flex-row-reverse" : "flex-row"}`}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white text-xl shadow-sm">
          {isHuman ? "🙂" : isMine ? "🤖" : "🦾"}
        </div>
        <div className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
          <span className={`mb-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold tracking-[0.1em] ${chip}`}>
            <span>{label}</span>
            {showAgentMarks && <span>AI 代理</span>}
          </span>
          <div className={`rounded-[1.6rem] px-4 py-3 text-[15px] leading-7 ${bubble} ${humanMode ? "rounded-[1.2rem]" : ""}`}>{message.text}</div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [match, setMatch] = useState(null);
  const [mode, setMode] = useState("live");
  const [meName, setMeName] = useState("我");
  const [meTier, setMeTier] = useState("full");
  const [visibleCount, setVisibleCount] = useState(0);
  const [takeover, setTakeover] = useState(false);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [taught, setTaught] = useState(0); // 这一页里补了几句
  const [rechat, setRechat] = useState(null); // {busy, error, before: {gaps, tier}}

  useEffect(() => {
    const data = loadSession(STORE.matches);
    const id = new URLSearchParams(window.location.search).get("id");
    const found = data?.matches?.find((m) => m.candidate.id === id) || data?.matches?.[0];
    if (!found) {
      setNotFound(true);
      return;
    }
    setMatch(found);
    setMode(data.mode);
    setMeName(data.me?.name || "我");
    setMeTier(data.me?.tier || "full");
    setDraft(found.icebreakers?.[0] || "你好呀，我们的claw刚刚聊得挺开心，认识一下？");
  }, []);

  useEffect(() => {
    if (!match) return undefined;
    setVisibleCount(0);
    const timer = window.setInterval(() => {
      setVisibleCount((c) => {
        if (c >= match.transcript.length) {
          window.clearInterval(timer);
          return c;
        }
        return c + 1;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [match]);

  function send() {
    if (!draft.trim()) return;
    setSent((s) => [...s, { speaker: "ME", text: draft.trim() }]);
    setDraft("");
  }

  // 补一句：并进单人体验里的卡（只存在本次会话里）
  async function teach(question, text) {
    const saved = loadSession(STORE.persona);
    if (!saved?.persona) throw new Error("找不到你的分身卡，回去重新生成一个");
    const res = await fetch("/api/persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 能走到这一页说明建卡时已经确认过年满 18 岁并同意分析说明
      body: JSON.stringify({ mode: "gap", persona: saved.persona, question, text, consent: true, adult: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "没记上，稍后再试");
    if (data.added?.length) {
      const prev = saved.persona;
      saveSession(STORE.persona, { ...saved, persona: data.persona });
      setTaught((n) => n + 1);
      return {
        added: data.added,
        undo: async () => {
          saveSession(STORE.persona, { ...loadSession(STORE.persona), persona: prev });
          setTaught((n) => Math.max(0, n - 1));
        },
      };
    }
    return { added: [] };
  }

  // 带着补过的卡，和同一位候选人再聊一次
  async function chatAgain() {
    const saved = loadSession(STORE.persona);
    const before = { gaps: match.gaps?.length || 0, tier: match.tier };
    setRechat({ busy: true, before });
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: saved.persona, candidateId: match.candidate.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "这次没聊成");
      const all = loadSession(STORE.matches) || { matches: [] };
      const matches = all.matches.map((m) => (m.candidate.id === data.match.candidate.id ? data.match : m)).sort((a, b) => b.score - a.score);
      saveSession(STORE.matches, { ...all, mode: data.mode, me: data.me, matches });
      setRechat({ busy: false, before, round: (rechat?.round || 1) + 1 });
      setTaught(0);
      setMatch(data.match);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setRechat({ busy: false, before, error: e.message });
    }
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#eef7ff] p-6 font-display">
        <Link href="/try" className="rounded-2xl bg-white px-5 py-4 text-sm font-bold text-slate-700 shadow">
          还没有匹配结果，先去生成你的claw →
        </Link>
      </main>
    );
  }
  if (!match) return null;

  const names = { me: meName, other: match.candidate.name };
  const messages = [...match.transcript.slice(0, visibleCount), ...sent];

  return (
    <motion.main
      animate={{
        background: takeover
          ? "linear-gradient(180deg, #d8dee8 0%, #eceff4 100%)"
          : "linear-gradient(180deg, #dff1ff 0%, #eff7ff 42%, #fff2e6 100%)",
      }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-screen font-display text-slate-900"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
        <header className="sticky top-0 z-20 border-b border-white/60 bg-white/75 px-4 pb-3 pt-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <Link href="/mixer" className="rounded-[1rem] border border-slate-200 bg-white px-3 py-2 text-xs font-bold tracking-[0.18em] text-slate-600">
              返回
            </Link>
            <div className="text-center">
              <p className="text-[11px] font-bold tracking-[0.26em] text-slate-400">{takeover ? "QQ 聊天" : "claw接管中"}</p>
              <h1 className="mt-1 text-base font-black leading-6 text-slate-900">
                {takeover ? `和 ${match.candidate.name} 聊天` : "AI 代聊记录"}
              </h1>
            </div>
            <div className={`rounded-[1rem] px-3 py-2 text-xs font-bold tracking-[0.18em] ${takeover ? "bg-emerald-600 text-emerald-50" : "bg-slate-900 text-sky-200"}`}>
              {takeover ? "真人" : "AI"}
            </div>
          </div>
        </header>

        <section className="px-4 pb-48 pt-4">
          <AnimatePresence initial={false}>
            {!takeover && (
              <motion.div
                key="agent-note"
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                className="space-y-3 rounded-[1.6rem] border border-cyan-100 bg-white/70 p-4 shadow-[0_16px_50px_rgba(148,197,255,0.18)] backdrop-blur"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-800">为什么推荐你们认识</p>
                  <TierBadge tier={match.tier} />
                </div>
                <ul className="space-y-1 text-[13px] leading-6 text-slate-600">
                  {match.reasons.map((r) => <li key={r}>✓ {r}</li>)}
                  {match.risks.map((r) => <li key={r} className="text-slate-400">△ {r}</li>)}
                </ul>
                <p className="text-[12px] leading-5 text-slate-500">
                  下面的气泡来自双方的 AI 分身，不是真人本人。分身只使用人格卡里的信息，不会透露联系方式等隐私。
                </p>
                {match.candidate.tier === "quick" && (
                  <p className="rounded-xl bg-slate-100 px-3 py-2 text-[12px] text-slate-500">TA 的分身信息较少</p>
                )}
                {meTier === "quick" && (
                  <p className="rounded-xl bg-slate-100 px-3 py-2 text-[12px] text-slate-500">你用的是速通卡，对方会看到“TA 的分身信息较少”。</p>
                )}
                <ModeBadge mode={mode} />
                {rechat?.round > 1 && !rechat.busy && (
                  <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[12px] leading-5 text-emerald-700">
                    第 {rechat.round} 次代聊：分身带着你刚补的话重新聊了一遍。上次卡住 {rechat.before.gaps} 次，这次卡住 {match.gaps?.length || 0} 次
                    {rechat.before.tier?.key !== match.tier?.key ? `；推荐从“${rechat.before.tier?.label}”变成“${match.tier?.label}”` : ""}。
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!takeover && meTier === "quick" && <UpgradeHint dark={false} />}

          <div className="mt-5 flex flex-col gap-4">
            {messages.map((m, i) => (
              <motion.div key={`${m.speaker}-${i}`} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.35 }}>
                <ChatBubble message={m} humanMode={takeover} names={names} />
              </motion.div>
            ))}
            {!takeover && visibleCount < match.transcript.length && (
              <div className="flex justify-start">
                <div className="rounded-full bg-white/80 px-4 py-2 text-sm font-bold text-slate-500 shadow-sm">claw正在输入...</div>
              </div>
            )}
            {sent.length > 0 && (
              <p className="text-center text-[12px] text-slate-400">演示版：消息不会真的发给对方</p>
            )}
          </div>

          {!takeover && visibleCount >= match.transcript.length && (
            <GapPanel
              match={match}
              taught={taught}
              rechat={rechat}
              onTeach={teach}
              onRechat={chatAgain}
            />
          )}
        </section>

        <AnimatePresence mode="wait" initial={false}>
          {!takeover ? (
            <motion.div
              key="takeover-cta"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 26 }}
              className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5"
            >
              <div className="pointer-events-auto w-full max-w-md rounded-[1.8rem] bg-[linear-gradient(90deg,_#12a4ff,_#7fdcff,_#ffd66b)] p-[1px] shadow-[0_0_35px_rgba(18,164,255,0.35)]">
                <motion.button
                  whileTap={{ scale: 0.985 }}
                  type="button"
                  onClick={() => setTakeover(true)}
                  className="w-full rounded-[1.75rem] bg-slate-950/92 px-5 py-5 text-base font-black leading-6 text-white"
                >
                  有点意思，我来接管一下
                  <br />
                  以真人身份打个招呼
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="human-input"
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 26 }}
              className="fixed inset-x-0 bottom-0 z-30 flex justify-center border-t border-slate-300/80 bg-[#f3f5f7]/95 px-3 pb-3 pt-3 backdrop-blur"
            >
              <div className="w-full max-w-md space-y-2">
                {match.icebreakers?.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {match.icebreakers.map((ice) => (
                      <button key={ice} type="button" onClick={() => setDraft(ice)} className="shrink-0 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs text-sky-700">
                        💡 {ice}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex-1 rounded-[1.4rem] border border-slate-300 bg-white px-4 py-3 shadow-sm">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={2}
                      className="min-h-[52px] w-full resize-none border-0 bg-transparent text-[15px] leading-6 text-slate-800 outline-none"
                    />
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={send}
                    className="rounded-[1.2rem] bg-[#12a4ff] px-4 py-4 text-sm font-black text-white shadow-[0_10px_20px_rgba(18,164,255,0.25)]"
                  >
                    发送
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.main>
  );
}

/**
 * 代聊播完后出现：分身被问住的地方 + 对方分身的悄悄话。
 * 悄悄话（对方分身私下的评价）先模糊着，补一句才解开，给一点“想知道 TA 怎么看我”的期待。
 */
function GapPanel({ match, taught, rechat, onTeach, onRechat }) {
  const gaps = match.gaps || [];
  const whisper = match.selfReasons?.[1];
  const [peek, setPeek] = useState(false);
  const unlocked = taught > 0 || peek || !gaps.length;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="mt-8 space-y-3 rounded-[1.8rem] bg-slate-950 p-4 text-white shadow-[0_20px_50px_rgba(9,32,59,0.35)]"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-200/80">聊完之后</p>
        <span className="text-[11px] text-cyan-100/50">只有你能看到</span>
      </div>

      {whisper && (
        <div className="relative overflow-hidden rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <p className="text-[12px] font-bold text-cyan-100/70">{match.candidate.name} 的分身私下说</p>
          <p className={`mt-1 text-sm leading-6 transition-all duration-700 ${unlocked ? "" : "select-none blur-[6px]"}`}>「{whisper}」</p>
          {!unlocked && (
            <button type="button" onClick={() => setPeek(true)} className="absolute inset-0 flex items-center justify-center bg-slate-950/30 text-xs font-black text-[#ffd66b]">
              🔒 帮你的分身补一句就能看到 · 或者直接偷看
            </button>
          )}
        </div>
      )}

      {gaps.length > 0 ? (
        <>
          <div>
            <h3 className="text-lg font-black leading-7">你的分身被问住了 {gaps.length} 次</h3>
            <p className="text-[12px] leading-5 text-cyan-100/70">分身只知道你告诉过它的。替它补一句，下次再聊到就能接上，也会帮你配到更对路的人。</p>
          </div>
          {gaps.map((g) => (
            <GapAsk key={`${match.candidate.id}-${g.quote}`} tone="dark" gap={g} otherName={match.candidate.name} onSubmit={(text) => onTeach(g.ask, text)} />
          ))}
        </>
      ) : (
        <p className="text-sm leading-6 text-cyan-50">这次你的分身没被问住。想让它更懂你，可以回去在卡上多补几句。</p>
      )}

      {taught > 0 && (
        <button
          type="button"
          disabled={rechat?.busy}
          onClick={onRechat}
          className="w-full rounded-[1.4rem] bg-[#ffd66b] px-4 py-3 text-sm font-black text-slate-900 disabled:opacity-60"
        >
          {rechat?.busy ? "分身正在重新聊…（30 秒左右）" : `让分身带着新信息，和 ${match.candidate.name} 再聊一次`}
        </button>
      )}
      {rechat?.error && <p className="text-xs text-rose-300">{rechat.error}</p>}
    </motion.section>
  );
}
