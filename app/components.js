"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// 页面间共享的小组件和会话存储工具

export const STORE = {
  persona: "socialq.persona",
  matches: "socialq.matches",
  onboarding: "socialq.onboarding", // 三问引导的半路进度，中途退出下次接着答
  upgradeHintClosed: "socialq.upgradeHintClosed", // 速通卡升级提示，本次会话关掉后不再出现
  // 小区配对用自己的一套，和单人体验互不串卡
  communityPersona: "socialq.community.persona",
  communityOnboarding: "socialq.community.onboarding",
};

export function saveSession(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式等情况下忽略 */
  }
}

export function loadSession(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function ModeBadge({ mode }) {
  if (mode !== "demo") return null;
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
      演示模式 · 未接入大模型
    </span>
  );
}

export function RadarChart({ traits }) {
  const size = 250;
  const center = size / 2;
  const radius = 84;
  const levels = 4;
  const angleOf = (index) => -Math.PI / 2 + (Math.PI * 2 * index) / traits.length;
  const pointAt = (index, r) => [center + Math.cos(angleOf(index)) * r, center + Math.sin(angleOf(index)) * r];

  const points = traits.map((t, i) => pointAt(i, (t.score / 100) * radius).join(",")).join(" ");

  return (
    <div className="rounded-[2rem] bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" role="img" aria-label="人格雷达图">
        {Array.from({ length: levels }).map((_, level) => (
          <polygon
            key={level}
            points={traits.map((_, i) => pointAt(i, ((level + 1) / levels) * radius).join(",")).join(" ")}
            fill="none"
            stroke="rgba(31,41,55,0.12)"
            strokeWidth="1"
          />
        ))}
        {traits.map((t, i) => {
          const [x, y] = pointAt(i, radius);
          const [lx, ly] = pointAt(i, radius + 26);
          return (
            <g key={t.label}>
              <line x1={center} y1={center} x2={x} y2={y} stroke="rgba(31,41,55,0.14)" strokeWidth="1" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-slate-700 text-[10px] font-semibold">
                {t.label}
              </text>
            </g>
          );
        })}
        <polygon points={points} fill="rgba(18, 164, 255, 0.28)" stroke="rgba(18, 164, 255, 0.95)" strokeWidth="3" strokeLinejoin="round" />
        {traits.map((t, i) => {
          const [x, y] = pointAt(i, (t.score / 100) * radius);
          return <circle key={t.label} cx={x} cy={y} r="4.5" fill="#12a4ff" />;
        })}
      </svg>
    </div>
  );
}

const TIER_STYLE = {
  high: "bg-emerald-100 text-emerald-700 border-emerald-200",
  mid: "bg-sky-100 text-sky-700 border-sky-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

export function TierBadge({ tier }) {
  if (!tier) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black ${TIER_STYLE[tier.key] || TIER_STYLE.low}`}>
      {tier.label}
    </span>
  );
}

// 速通卡升级提示：本次会话关掉后不再出现（mixer 和 chat 共用一个开关）
export function UpgradeHint({ dark = true }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(Boolean(loadSession(STORE.upgradeHintClosed))), []);
  if (hidden) return null;
  return (
    <div className={`relative z-10 mt-4 rounded-[1.6rem] border px-4 py-3 text-sm leading-6 ${dark ? "border-amber-200/40 bg-amber-300/15 text-amber-50" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <p>你的分身只知道你喜欢什么类型。聊 3 个问题，它就能说出具体的了。</p>
      <div className="mt-2 flex gap-2">
        <Link href="/try" className="rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-slate-900">
          让分身更像我
        </Link>
        <button
          type="button"
          onClick={() => {
            saveSession(STORE.upgradeHintClosed, true);
            setHidden(true);
          }}
          className="rounded-full border border-current px-3 py-1 text-xs font-bold opacity-80"
        >
          先不了
        </button>
      </div>
    </div>
  );
}

