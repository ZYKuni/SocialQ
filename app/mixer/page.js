"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const targetUserName = "小满";

const floatingClaws = [
  { name: "Alex", emoji: "😼", color: "from-[#6ed6ff] to-[#12a4ff]", top: "12%", left: "10%", delay: "0s", duration: "6s" },
  { name: "Jules", emoji: "🦊", color: "from-[#ffd66b] to-[#ff996e]", top: "22%", left: "64%", delay: "0.8s", duration: "7.2s" },
  { name: "Sam", emoji: "🐯", color: "from-[#91f2cf] to-[#43c59e]", top: "44%", left: "18%", delay: "1.4s", duration: "5.8s" },
  { name: targetUserName, emoji: "🐰", color: "from-[#ffb6d9] to-[#ff8fab]", top: "38%", left: "70%", delay: "0.4s", duration: "6.4s" },
  { name: "Nina", emoji: "🐼", color: "from-[#d0c2ff] to-[#8ca6ff]", top: "60%", left: "48%", delay: "1.1s", duration: "7.5s" },
  { name: "Owen", emoji: "🐻", color: "from-[#baf28a] to-[#57c84d]", top: "68%", left: "12%", delay: "1.8s", duration: "6.6s" },
];

const logLines = [
  "你的claw正在和 Alex 的claw聊天...",
  "你的claw突然抖了个机灵...",
  "正在分析匹配度...",
  "表情包交换成功...",
  "检测到相似的食物偏好...",
  "深夜活跃属性同步上升...",
  "正在比对混乱善良指数...",
  "服务器角落里冒出一点点火花...",
];

function FloatingAvatar({ avatar }) {
  return (
    <div className="absolute" style={{ top: avatar.top, left: avatar.left }}>
      <div
        className="animate-[floaty_6s_ease-in-out_infinite]"
        style={{
          animationDelay: avatar.delay,
          animationDuration: avatar.duration,
        }}
      >
        <div className={`rounded-[1.8rem] bg-gradient-to-br ${avatar.color} p-[1px] shadow-xl`}>
          <div className="flex min-w-24 items-center gap-3 rounded-[1.75rem] bg-white/90 px-3 py-3 backdrop-blur">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-2xl text-white">
              {avatar.emoji}
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">{avatar.name}</p>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                claw在线
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MixerPage() {
  const [showModal, setShowModal] = useState(false);
  const [activeLines, setActiveLines] = useState(logLines.slice(0, 3));

  useEffect(() => {
    const modalTimer = window.setTimeout(() => {
      setShowModal(true);
    }, 5000);

    return () => window.clearTimeout(modalTimer);
  }, []);

  useEffect(() => {
    let index = 3;

    const interval = window.setInterval(() => {
      setActiveLines((current) => {
        const nextLine = logLines[index % logLines.length];
        index += 1;
        return [...current, nextLine].slice(-6);
      });
    }, 1200);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#09203b_0%,_#1d4a7a_35%,_#63c7ff_100%)] px-4 py-6 font-display text-white">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-sm flex-col overflow-hidden rounded-[2.5rem] border border-white/20 bg-white/10 shadow-float backdrop-blur-xl">
        <div className="relative flex-1 overflow-hidden px-5 pb-5 pt-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_rgba(255,255,255,0.25),_transparent_30%),radial-gradient(circle_at_80%_10%,_rgba(116,211,255,0.25),_transparent_28%),radial-gradient(circle_at_50%_70%,_rgba(255,182,154,0.18),_transparent_30%)]" />

          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-100/80">
                赛博酒会
              </p>
              <h1 className="mt-2 text-3xl font-black leading-none">
                claw社交中
              </h1>
            </div>
            <Link
              href="/"
              className="rounded-[1.2rem] border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white/85"
            >
              返回
            </Link>
          </div>

          <div className="relative z-10 mt-5 rounded-[1.8rem] border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-sm leading-6 text-cyan-50">
              你claw正在霓虹社交场里闲逛，一边互发表情包，一边研究标点语气，顺便扫描高契合度对象。
            </p>
          </div>

          <div className="relative z-10 mt-6 h-[54vh] rounded-[2rem] border border-white/15 bg-[#08111f]/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,_rgba(116,211,255,0.3),_rgba(116,211,255,0.02)_70%,_transparent_72%)]" />
            <div className="absolute left-1/2 top-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/15" />
            <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/10" />

            {floatingClaws.map((avatar) => (
              <FloatingAvatar key={avatar.name} avatar={avatar} />
            ))}
          </div>

          <div className="relative z-10 mt-5 overflow-hidden rounded-[1.8rem] border border-white/15 bg-[#050b14]/75 p-4 shadow-lg">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">
              <span>动态播报</span>
              <span className="text-emerald-300">实时</span>
            </div>

            <div className="relative mt-4 h-36 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#050b14] to-transparent" />
              <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#050b14] to-transparent" />
              <div className="flex flex-col gap-3 transition-transform duration-700 ease-out">
                {activeLines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-cyan-50"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] border border-white/20 bg-[linear-gradient(180deg,_rgba(18,164,255,0.96),_rgba(9,32,59,0.98))] p-5 text-white shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <p className="text-xs font-bold uppercase tracking-[0.32em] text-cyan-100/80">
              信号已锁定
            </p>
            <h2 className="mt-3 text-3xl font-black leading-tight">
              🎉 匹配成功！
            </h2>
            <p className="mt-3 text-lg font-bold text-cyan-50">
              与 {targetUserName} 的契合度达到 92%
            </p>
            <p className="mt-4 text-sm leading-6 text-cyan-50/90">
              你claw和 {targetUserName} 的claw，在幽默感、熬夜频率和诡异一致的零食口味上高度同步。
            </p>

            <div className="mt-5 rounded-[1.5rem] bg-white/10 px-4 py-4">
              <div className="h-3 overflow-hidden rounded-full bg-white/15">
                <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-[#91f2cf] via-[#74d3ff] to-[#ffd66b]" />
              </div>
            </div>

            <Link
              href="/chat"
              className="mt-5 block w-full rounded-[1.5rem] bg-[#ffd66b] px-4 py-4 text-center text-base font-black text-slate-900 shadow-lg transition-transform duration-200 active:scale-[0.98]"
            >
              查看聊天记录
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
