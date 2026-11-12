"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// 从代聊补卡的前端组件：分身答不上来的一个问题 → 本人补一句。单人体验和本周配对页共用。
// onSubmit(text) 返回 {added: string[], note?, undo?}；给了 undo 就显示“撤回”。

export function GapAsk({ gap, otherName, onSubmit, tone = "light", placeholder = "随手说一句，比如具体的名字、喜欢它哪一点" }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // {added, note}
  const dark = tone === "dark";

  async function submit() {
    if (text.trim().length < 2 || busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await onSubmit(text.trim()));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-[1.4rem] p-4 ${dark ? "border border-white/15 bg-white/10" : "border border-slate-100 bg-white shadow-sm"}`}>
      {gap.quote && (
        <p className={`text-[12px] leading-5 ${dark ? "text-cyan-100/70" : "text-slate-400"}`}>
          {otherName} 的分身问：<span className={dark ? "text-cyan-50" : "text-slate-600"}>「{gap.quote}」</span>
        </p>
      )}
      <p className={`mt-1 text-sm font-black leading-6 ${dark ? "text-white" : "text-slate-800"}`}>{gap.ask}</p>
      <AnimatePresence mode="wait" initial={false}>
        {result ? (
          <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
            {result.added?.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`text-xs font-bold ${dark ? "text-emerald-200" : "text-emerald-600"}`}>{result.note || "分身记住了"}</span>
                {result.added.map((a) => (
                  <span key={a} className={`rounded-full px-2.5 py-1 text-xs font-bold ${dark ? "bg-emerald-300/20 text-emerald-100" : "bg-emerald-50 text-emerald-700"}`}>{a}</span>
                ))}
              </div>
            ) : (
              <p className={`text-xs ${dark ? "text-cyan-100/70" : "text-slate-400"}`}>
                {result.note || "这句里没找到能记下来的具体东西。"}
                <button type="button" onClick={() => setResult(null)} className={`ml-1 font-bold ${dark ? "text-[#ffd66b]" : "text-qqBlue"}`}>
                  换个说法
                </button>
              </p>
            )}
            {result.undo && result.added?.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await result.undo();
                    setResult({ added: [], note: "已撤回，分身没记这一句" });
                  } catch (e) {
                    setError(e.message);
                  }
                }}
                className={`mt-2 text-[11px] underline-offset-2 hover:underline ${dark ? "text-cyan-100/60" : "text-slate-400"}`}
              >
                记错了，撤回
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div key="ask" className="mt-3 flex gap-2" exit={{ opacity: 0 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              maxLength={200}
              placeholder={placeholder}
              className={`min-w-0 flex-1 rounded-2xl px-3 py-2 text-sm outline-none ${dark ? "border border-white/20 bg-slate-950/40 text-white placeholder:text-cyan-100/40 focus:border-cyan-200" : "border border-slate-200 bg-white focus:border-qqBlue"}`}
            />
            <button
              type="button"
              disabled={text.trim().length < 2 || busy}
              onClick={submit}
              className={`shrink-0 whitespace-nowrap rounded-2xl px-3 py-2 text-xs font-black disabled:opacity-40 ${dark ? "bg-[#ffd66b] text-slate-900" : "bg-qqBlue text-white"}`}
            >
              {busy ? "记下中..." : "告诉分身"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
    </div>
  );
}
