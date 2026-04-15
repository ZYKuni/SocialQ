"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const loadingLines = [
  "Booting claw compiler...",
  "Extracting dark humor...",
  "Analyzing late-night food cravings...",
  "Sorting unread voice notes by emotional damage...",
  "Injecting personality...",
  "Polishing the chaos into charm...",
];

const progressStops = [18, 36, 57, 73, 88, 100];

const traits = [
  { label: "Chaos", value: 84 },
  { label: "Charm", value: 92 },
  { label: "Loyalty", value: 76 },
  { label: "Curiosity", value: 87 },
  { label: "Meme IQ", value: 81 },
  { label: "Night Owl", value: 69 },
];

function RadarChart() {
  const size = 250;
  const center = size / 2;
  const radius = 84;
  const levels = 4;

  const points = traits
    .map((trait, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / traits.length;
      const pointRadius = (trait.value / 100) * radius;
      const x = center + Math.cos(angle) * pointRadius;
      const y = center + Math.sin(angle) * pointRadius;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-[2rem] bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
        {Array.from({ length: levels }).map((_, level) => {
          const levelRadius = ((level + 1) / levels) * radius;
          const ring = traits
            .map((_, index) => {
              const angle = -Math.PI / 2 + (Math.PI * 2 * index) / traits.length;
              const x = center + Math.cos(angle) * levelRadius;
              const y = center + Math.sin(angle) * levelRadius;
              return `${x},${y}`;
            })
            .join(" ");

          return (
            <polygon
              key={level}
              points={ring}
              fill="none"
              stroke="rgba(31,41,55,0.12)"
              strokeWidth="1"
            />
          );
        })}

        {traits.map((trait, index) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * index) / traits.length;
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;
          const labelX = center + Math.cos(angle) * (radius + 26);
          const labelY = center + Math.sin(angle) * (radius + 26);

          return (
            <g key={trait.label}>
              <line
                x1={center}
                y1={center}
                x2={x}
                y2={y}
                stroke="rgba(31,41,55,0.14)"
                strokeWidth="1"
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-700 text-[10px] font-semibold"
              >
                {trait.label}
              </text>
            </g>
          );
        })}

        <polygon
          points={points}
          fill="rgba(18, 164, 255, 0.28)"
          stroke="rgba(18, 164, 255, 0.95)"
          strokeWidth="3"
          strokeLinejoin="round"
        />

        {traits.map((trait, index) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * index) / traits.length;
          const pointRadius = (trait.value / 100) * radius;
          const x = center + Math.cos(angle) * pointRadius;
          const y = center + Math.sin(angle) * pointRadius;

          return <circle key={trait.label} cx={x} cy={y} r="4.5" fill="#12a4ff" />;
        })}
      </svg>
    </div>
  );
}

export default function HomePage() {
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    if (stage !== "loading") {
      return undefined;
    }

    setProgress(0);
    setLineIndex(0);

    const tickInterval = window.setInterval(() => {
      setLineIndex((current) =>
        current < loadingLines.length - 1 ? current + 1 : current
      );
    }, 1000);

    const progressInterval = window.setInterval(() => {
      setProgress((current) => {
        const nextStop =
          progressStops.find((stop) => stop > current) ?? progressStops.at(-1);
        return nextStop;
      });
    }, 500);

    const finishTimeout = window.setTimeout(() => {
      setProgress(100);
      setStage("success");
    }, 3000);

    return () => {
      window.clearInterval(tickInterval);
      window.clearInterval(progressInterval);
      window.clearTimeout(finishTimeout);
    };
  }, [stage]);

  const startFlow = () => {
    setStage("loading");
  };

  const resetFlow = () => {
    setStage("idle");
    setProgress(0);
    setLineIndex(0);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e8fbff_0%,_#cfeeff_35%,_#f8c7a3_100%)] px-4 py-6 font-display text-ink">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-sm flex-col overflow-hidden rounded-[2.5rem] border border-white/70 bg-white/55 shadow-float backdrop-blur">
        <div className="relative overflow-hidden px-5 pb-6 pt-5">
          <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top,_rgba(116,211,255,0.95),_rgba(255,255,255,0))]" />

          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-slate-500">
                SocialQ Lab
              </p>
              <h1 className="mt-2 text-3xl font-black leading-none text-slate-900">
                Create My Claw
              </h1>
            </div>
            <div className="animate-bob rounded-[1.4rem] bg-white px-4 py-3 text-3xl shadow-lg">
              🐾
            </div>
          </div>

          <div className="relative mt-6 rounded-[2rem] bg-[#fff9ee] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            {stage === "idle" && (
              <section className="space-y-5">
                <div className="rounded-[1.6rem] bg-gradient-to-br from-qqBlue via-qqSky to-qqMint p-[1px]">
                  <div className="rounded-[1.55rem] bg-slate-950/95 p-4 text-[#b6ffe8]">
                    <p className="text-xs uppercase tracking-[0.28em] text-[#7cdac8]">
                      Mini Program Boot Screen
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#d8fff4]">
                      Grant a tiny bit of QQ chat chaos so we can grow your
                      legendary claw persona.
                    </p>
                  </div>
                </div>

                <div className="rounded-[1.6rem] bg-white p-4 shadow-sm">
                  <p className="text-sm leading-6 text-slate-600">
                    We&apos;ll pretend to read your chat history, remix your
                    vibes, and hatch a lovable creature profile in seconds.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={startFlow}
                  className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-5 text-lg font-black text-white shadow-lg transition-transform duration-200 active:scale-[0.98]"
                >
                  Authorize QQ Chat History
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
                    <span className="ml-2">Claw Terminal</span>
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
                    <span>Compiling your creature...</span>
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

            {stage === "success" && (
              <section className="space-y-5">
                <div className="rounded-[1.8rem] bg-gradient-to-br from-white to-[#eef9ff] p-5 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-[#d9f5ff] px-3 py-2 text-2xl">
                      ✨
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.28em] text-slate-500">
                        Success
                      </p>
                      <h2 className="text-2xl font-black text-slate-900">
                        Your Claw is alive
                      </h2>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    Mischievous, magnetic, slightly sleep-deprived, and
                    suspiciously excellent at sending perfect reaction images.
                  </p>

                  <div className="mt-4 aspect-square w-full">
                    <RadarChart />
                  </div>
                </div>

                <Link
                  href="/mixer"
                  className="block w-full rounded-[1.7rem] bg-gradient-to-r from-[#ff996e] to-[#ffd66b] px-5 py-5 text-center text-lg font-black text-slate-900 shadow-lg transition-transform duration-200 active:scale-[0.98]"
                >
                  Release my Claw into the wild
                </Link>

                <button
                  type="button"
                  onClick={resetFlow}
                  className="w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500"
                >
                  Start over
                </button>
              </section>
            )}
          </div>

          <div className="relative mt-5 grid grid-cols-3 gap-3 text-center text-xs font-bold text-slate-600">
            <div className="rounded-[1.4rem] bg-white/80 px-3 py-3">
              93%
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Sass
              </p>
            </div>
            <div className="rounded-[1.4rem] bg-white/80 px-3 py-3">
              24/7
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Online-ish
              </p>
            </div>
            <div className="rounded-[1.4rem] bg-white/80 px-3 py-3">
              A+
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Vibes
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
