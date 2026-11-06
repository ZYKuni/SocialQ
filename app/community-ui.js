"use client";

import { useState } from "react";
import Link from "next/link";

// 小区试点的前端小组件：登录注册、顶部的账号栏。

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/community/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "出错了，请稍后再试"), { status: res.status });
  return data;
}

export function AuthPanel({ members = 0, onAuthed }) {
  const [mode, setMode] = useState("register");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  const ready = nickname.trim() && password && (!isRegister || (code.trim() && adult && consent));

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api("auth", { method: "POST", body: { action: mode, nickname, password, code } });
      onAuthed(data.user, { registered: isRegister });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-qqBlue";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-[1.6rem] bg-slate-950/95 p-4 text-[#d8fff4]">
        <p className="text-xs uppercase tracking-[0.28em] text-[#7cdac8]">小区邻居试用</p>
        <p className="mt-2 text-sm leading-6">造一个替你开口的 AI 分身。每周三统一配对，分身先和邻居聊几句，聊得来你们再认识。</p>
        {members > 0 && <p className="mt-2 text-xs text-[#7cdac8]">已有 {members} 位邻居建好了分身</p>}
      </div>

      <div className="flex rounded-2xl bg-white p-1 text-sm font-bold shadow-sm">
        {[["register", "第一次来"], ["login", "已有账号"]].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setMode(k);
              setError("");
            }}
            className={`flex-1 rounded-xl py-2 ${mode === k ? "bg-qqBlue text-white" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="block text-xs font-bold text-slate-500">
        昵称{isRegister && <span className="font-normal text-slate-400">（2 到 16 个字，不能和别人重复，配对时对方看到的就是它）</span>}
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} autoComplete="username" className={input} />
      </label>
      <label className="block text-xs font-bold text-slate-500">
        密码{isRegister && <span className="font-normal text-slate-400">（至少 6 位，自己记住）</span>}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isRegister ? "new-password" : "current-password"} className={input} />
      </label>
      {isRegister && (
        <>
          <label className="block text-xs font-bold text-slate-500">
            小区口令<span className="font-normal text-slate-400">（在邻居群里问组织者）</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className={input} />
          </label>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>我已年满 18 岁</span>
          </label>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              我同意 SocialQ 保存我的昵称、分身卡和配对记录，只用于这次小区试用；组织者能看到分身之间的对话。我可以随时注销，注销后数据全部删除。
            </span>
          </label>
        </>
      )}

      {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={!ready || busy}
        className="w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-4 text-base font-black text-white shadow-lg disabled:opacity-40"
      >
        {busy ? "请稍候..." : isRegister ? "注册并开始" : "登录"}
      </button>
    </form>
  );
}

export function UserBar({ user, onLogout }) {
  if (!user) return null;
  async function logout() {
    await api("auth", { method: "POST", body: { action: "logout" } }).catch(() => {});
    onLogout?.();
  }
  return (
    <div className="relative mt-3 flex items-center justify-between rounded-2xl bg-white/70 px-3 py-2 text-xs text-slate-500">
      <span>
        你好，<b className="text-slate-700">{user.nickname}</b>
      </span>
      <span className="flex gap-3">
        <Link href="/matches" className="font-bold text-qqBlue">本周配对</Link>
        <button type="button" onClick={logout} className="font-bold">退出</button>
      </span>
    </div>
  );
}
