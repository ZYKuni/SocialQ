"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SAMPLE_POOL } from "@/lib/samplePool.mjs";
import { ModeBadge, TierBadge, STORE, loadSession, saveSession } from "../components";

const POSITIONS = [
  { top: "12%", left: "8%", delay: "0s", duration: "6s" },
  { top: "22%", left: "60%", delay: "0.8s", duration: "7.2s" },
  { top: "44%", left: "14%", delay: "1.4s", duration: "5.8s" },
  { top: "40%", left: "64%", delay: "0.4s", duration: "6.4s" },
  { top: "62%", left: "42%", delay: "1.1s", duration: "7.5s" },
  { top: "70%", left: "6%", delay: "1.8s", duration: "6.6s" },
];

function FloatingAvatar({ avatar, pos, highlight }) {
  return (
    <div className="absolute" style={{ top: pos.top, left: pos.left }}>
      <div className="animate-[floaty_6s_ease-in-out_infinite]" style={{ animationDelay: pos.delay, animationDuration: pos.duration }}>
        <div className={`rounded-[1.8rem] bg-gradient-to-br ${avatar.color} p-[1px] shadow-xl ${highlight ? "ring-4 ring-[#ffd66b]" : ""}`}>
          <div className="flex min-w-24 items-center gap-3 rounded-[1.75rem] bg-white/90 px-3 py-3 backdrop-blur">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-2xl text-white">{avatar.emoji}</div>
            <div>
              <p className="text-sm font-black text-slate-900">{avatar.name}</p>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">claw在线</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MixerPage() {
  const router = useRouter();
  const [persona, setPersona] = useState(null);
  const [missing, setMissing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [lines, setLines] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const started = useRef(false);

  const run = useCallback(async (p) => {
    setError("");
    setData(null);
    setShowModal(false);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: p }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "匹配失败");
      setData(json);
      saveSession(STORE.matches, json);
      setLines(
        json.matches.map((m) => `和 ${m.candidate.name} 的claw聊了 ${m.transcript.length} 句 · ${m.tier.label}`)
      );
      window.setTimeout(() => setShowModal(true), 600);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const saved = loadSession(STORE.persona);
    if (!saved?.persona) {
      setMissing(true);
      return;
    }
    setPersona(saved.persona);
    const cached = loadSession(STORE.matches);
    if (cached?.matches?.length && cached.me?.name === saved.persona.name) {
      setData(cached);
      setLines(cached.matches.map((m) => `和 ${m.candidate.name} 的claw聊了 ${m.transcript.length} 句 · ${m.tier.label}`));
      setShowModal(true);
      return;
    }
    run(saved.persona);
  }, [run]);

  // 等待结果期间滚动播报
  useEffect(() => {
    if (data || error || missing) return undefined;
    let i = 0;
    const names = SAMPLE_POOL.map((c) => c.name);
    const templates = [
      (n) => `你的claw正在和 ${n} 的claw打招呼...`,
      (n) => `正在比对你和 ${n} 的兴趣...`,
      (n) => `${n} 的claw抛来一个梗...`,
      () => "裁判正在读代聊记录...",
    ];
    setLines(["按兴趣重合度粗筛候选...", "挑出前 3 位，让双方分身开聊..."]);
    const timer = window.setInterval(() => {
      const line = templates[i % templates.length](names[i % names.length]);
      i += 1;
      setLines((cur) => [...cur, line].slice(-6));
    }, 1300);
    return () => window.clearInterval(timer);
  }, [data, error, missing]);

  const top = data?.matches?.[0];
  const matchedIds = new Set((data?.matches || []).map((m) => m.candidate.id));

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#09203b_0%,_#1d4a7a_35%,_#63c7ff_100%)] px-4 py-6 font-display text-white">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-sm flex-col overflow-hidden rounded-[2.5rem] border border-white/20 bg-white/10 shadow-float backdrop-blur-xl">
        <div className="relative flex-1 overflow-hidden px-5 pb-5 pt-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_rgba(255,255,255,0.25),_transparent_30%),radial-gradient(circle_at_80%_10%,_rgba(116,211,255,0.25),_transparent_28%),radial-gradient(circle_at_50%_70%,_rgba(255,182,154,0.18),_transparent_30%)]" />

          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-100/80">赛博酒会</p>
              <h1 className="mt-2 text-3xl font-black leading-none">claw社交中</h1>
            </div>
            <Link href="/" className="rounded-[1.2rem] border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white/85">
              返回
            </Link>
          </div>

          <div className="relative z-10 mt-5 rounded-[1.8rem] border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-sm leading-6 text-cyan-50">
              {persona ? `「${persona.name}」的claw正在和示例用户的claw聊天，看看谁和你聊得来。` : "你的claw正在进场..."}
            </p>
            <p className="mt-1 text-[11px] text-cyan-100/70">候选均为虚构示例用户</p>
          </div>

          <div className="relative z-10 mt-6 h-[46vh] rounded-[2rem] border border-white/15 bg-[#08111f]/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,_rgba(116,211,255,0.3),_rgba(116,211,255,0.02)_70%,_transparent_72%)]" />
            <div className="absolute left-1/2 top-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/15" />
            {SAMPLE_POOL.map((avatar, i) => (
              <FloatingAvatar key={avatar.id} avatar={avatar} pos={POSITIONS[i % POSITIONS.length]} highlight={matchedIds.has(avatar.id)} />
            ))}
          </div>

          <div className="relative z-10 mt-5 overflow-hidden rounded-[1.8rem] border border-white/15 bg-[#050b14]/75 p-4 shadow-lg">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">
              <span>动态播报</span>
              <span className="text-emerald-300">{data ? "完成" : "实时"}</span>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {missing && (
                <Link href="/" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-cyan-50">
                  还没有生成claw，先回首页生成一个 →
                </Link>
              )}
              {error && (
                <button type="button" onClick={() => run(persona)} className="rounded-2xl border border-rose-300/40 bg-rose-500/20 px-3 py-3 text-left text-sm text-rose-50">
                  {error}，点这里重试
                </button>
              )}
              {lines.map((line, index) => (
                <div key={`${line}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-cyan-50">
                  {line}
                </div>
              ))}
              {data && !showModal && (
                <button type="button" onClick={() => setShowModal(true)} className="rounded-2xl bg-[#ffd66b] px-3 py-3 text-sm font-black text-slate-900">
                  查看匹配结果
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showModal && top && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/65 px-5 py-8 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] border border-white/20 bg-[linear-gradient(180deg,_rgba(18,164,255,0.96),_rgba(9,32,59,0.98))] p-5 text-white shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.32em] text-cyan-100/80">信号已锁定</p>
              <ModeBadge mode={data.mode} />
            </div>
            <h2 className="mt-3 text-3xl font-black leading-tight">
              {top.candidate.emoji} 你和 {top.candidate.name}
            </h2>
            <div className="mt-3">
              <TierBadge tier={top.tier} />
            </div>

            <ul className="mt-4 space-y-2 text-sm leading-6 text-cyan-50/90">
              {top.reasons.map((r) => (
                <li key={r}>✓ {r}</li>
              ))}
              {top.risks.map((r) => (
                <li key={r} className="text-cyan-100/70">△ {r}</li>
              ))}
            </ul>

            <Link
              href={`/chat?id=${top.candidate.id}`}
              className="mt-5 block w-full rounded-[1.5rem] bg-[#ffd66b] px-4 py-4 text-center text-base font-black text-slate-900 shadow-lg transition-transform duration-200 active:scale-[0.98]"
            >
              查看代聊记录
            </Link>

            {data.matches.length > 1 && (
              <div className="mt-4 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-100/70">其他聊过的候选</p>
                {data.matches.slice(1).map((m) => (
                  <button
                    key={m.candidate.id}
                    type="button"
                    onClick={() => router.push(`/chat?id=${m.candidate.id}`)}
                    className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-3 py-2 text-left text-sm"
                  >
                    <span>{m.candidate.emoji} {m.candidate.name}</span>
                    <TierBadge tier={m.tier} />
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowModal(false)} className="flex-1 rounded-2xl border border-white/20 px-3 py-2 text-xs font-bold text-white/80">
                关闭
              </button>
              <button type="button" onClick={() => run(persona)} className="flex-1 rounded-2xl border border-white/20 px-3 py-2 text-xs font-bold text-white/80">
                重新匹配
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-cyan-100/60">
              不展示精确“契合度”：我们的验证实验显示，见面前的信息只能弱预测两人是否合得来。
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
