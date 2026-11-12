"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../community-ui";
import { STORE, saveSession } from "../components";
import { GapAsk } from "../gap-ui";

// 小区试点：本周配对。看两个分身聊了什么，决定想不想认识；双方都想认识时互相看到微信号。

export default function MatchesPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const m = await api("me");
        setMe(m);
        if (!m.enabled) return;
        if (!m.user) return router.replace("/community");
        setData(await api("matches"));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [router]);

  // 补一句 → 服务端按最新的卡生成补完的版本 → 存成新版本。撤回就把补之前的卡再存一次。
  async function teach(question, text, matchId) {
    const prev = me?.card;
    const preview = await api("card/enrich", { method: "POST", body: { question, text, matchId } });
    if (!preview.added?.length) return { added: [] };
    const saved = await api("card", { method: "POST", body: { card: preview.card } });
    setMe((m) => ({ ...m, card: saved.card }));
    return {
      added: preview.added,
      note: "分身记住了，下一轮配对就会用上",
      undo: prev
        ? async () => {
            const back = await api("card", { method: "POST", body: { card: prev } });
            setMe((m) => ({ ...m, card: back.card }));
          }
        : null,
    };
  }

  const openGaps = (data?.matches || []).reduce((n, m) => n + (m.gaps || []).filter((g) => !isDone(g.id)).length, 0);

  function updateMatch(next) {
    setData((d) => ({ ...d, matches: d.matches.map((m) => (m.id === next.id ? next : m)) }));
  }

  return (
    <main className="min-h-screen bg-[#f4f8fc] px-4 py-6 font-display text-slate-800">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between text-xs font-bold text-slate-500">
          <Link href="/community">← 我的分身</Link>
          {me?.user && <span>{me.user.nickname}</span>}
        </div>
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-qqBlue">本周配对</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">分身先替你聊了几句</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            下面是 AI 分身之间的对话，不是真人说的话。看完决定想不想认识；只有你们两个都点了“想认识”，才会互相看到微信号。
          </p>
        </header>

        {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
        {!me && !error && <p className="py-10 text-center text-sm text-slate-400">加载中...</p>}
        {me && !me.enabled && (
          <Notice>
            小区试点还没开启。<Link href="/try" className="font-bold text-qqBlue">先单人体验一下 →</Link>
          </Notice>
        )}
        {me?.user && !me.card && (
          <Notice>
            你还没有分身卡，配对时不会排到你。<Link href="/community" className="font-bold text-qqBlue">先去建一张 →</Link>
          </Notice>
        )}

        {data && !data.round && (
          <Notice>
            第一轮还没开奖。每周三晚上统一配对{me?.members ? `，目前已有 ${me.members} 位邻居建好了分身` : ""}。开奖后组织者会在群里说一声。
          </Notice>
        )}
        {me?.card && data && <TeachBox openGaps={openGaps} onTeach={(q, t) => teach(q, t, null)} />}

        {data?.round && data.matches.length === 0 && <Notice>这一轮没有给你配上邻居，下周三再来看看。</Notice>}
        {data?.matches.map((m) => (
          <MatchCard key={m.id} match={m} onTeach={me?.card ? teach : null} onChange={updateMatch} onHide={(id) => setData((d) => ({ ...d, matches: d.matches.filter((x) => x.id !== id) }))} />
        ))}

        {me?.user && <Settings me={me} onMe={setMe} onGone={() => {
          saveSession(STORE.communityPersona, null);
          saveSession(STORE.communityOnboarding, null);
          router.replace("/");
        }} />}
      </div>
    </main>
  );
}

function Notice({ children }) {
  return <p className="rounded-3xl bg-white p-5 text-sm leading-7 text-slate-600 shadow-sm">{children}</p>;
}

// 已经补过的问题记在本机，不再重复问（换设备会再出现一次，不影响什么）
const DONE_KEY = "socialq.gapsDone";
function isDone(id) {
  try {
    return JSON.parse(window.localStorage.getItem(DONE_KEY) || "[]").includes(id);
  } catch {
    return false;
  }
}
function markDone(id) {
  try {
    const list = JSON.parse(window.localStorage.getItem(DONE_KEY) || "[]");
    if (!list.includes(id)) window.localStorage.setItem(DONE_KEY, JSON.stringify([...list, id].slice(-200)));
  } catch {
    // 本机存不了也没关系，只是下次还会问
  }
}

/** 页面顶部：让分身更懂你。提示还有几个问题没答，也可以随手补一句。 */
function TeachBox({ openGaps, onTeach }) {
  return (
    <section className="space-y-3 rounded-3xl bg-slate-900 p-5 text-white shadow-sm">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-200/80">让分身更懂你</p>
        <h2 className="mt-1 text-lg font-black leading-7">
          {openGaps > 0 ? `这周你的分身被问住了 ${openGaps} 次` : "分身只知道你告诉过它的"}
        </h2>
        <p className="mt-1 text-xs leading-5 text-cyan-100/70">
          {openGaps > 0 ? "在下面每段对话后面补一句，下一轮它就能接上，也更容易配到对路的人。" : "随手补一句，下一轮配对就会用上。只有配对对象能看到你补的内容。"}
        </p>
      </div>
      <GapAsk
        tone="dark"
        gap={{ ask: "还有什么想让分身知道的？" }}
        placeholder="最近在玩的、在追的、想一起做的事"
        onSubmit={(text) => onTeach("还有什么想让分身知道的？", text)}
      />
    </section>
  );
}

function MatchCard({ match, onChange, onHide, onTeach }) {
  const [done, setDone] = useState(() => new Set());
  useEffect(() => setDone(new Set((match.gaps || []).filter((g) => isDone(g.id)).map((g) => g.id))), [match.gaps]);
  const gaps = (match.gaps || []).filter((g) => !done.has(g.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { other } = match;
  const card = other.card;

  async function choose(choice) {
    setBusy(true);
    setError("");
    try {
      const res = await api("matches", { method: "POST", body: { matchId: match.id, choice } });
      onChange(res.match);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    const reason = window.prompt(`举报并拉黑 ${other.nickname}？之后不会再互相推荐。可以写一句原因（选填）：`);
    if (reason === null) return;
    try {
      await api("report", { method: "POST", body: { matchId: match.id, reason } });
      onHide(match.id);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <article className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-black text-slate-900">{other.nickname}</h2>
        {card?.tier === "quick" && <p className="text-xs text-slate-400">TA 的分身信息较少，对话可能比较泛</p>}
        {card?.selfIntro && <p className="mt-1 text-sm text-slate-600">{card.selfIntro}</p>}
        {card?.lookingFor && <p className="mt-1 text-xs text-slate-500">想认识：{card.lookingFor}</p>}
      </div>

      {card && (card.interests.length > 0 || card.situations.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {match.shared.map((s) => (
            <li key={`shared-${s}`} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">共同：{s}</li>
          ))}
          {card.interests
            .filter((i) => !match.shared.includes(i.label))
            .map((i) => (
              <li key={i.label} title={i.evidence ? `TA 说过：“${i.evidence}”` : undefined} className="rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700">
                {i.label}
              </li>
            ))}
          {card.situations.map((s) => (
            <li key={s.label} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">近况：{s.label}</li>
          ))}
        </ul>
      )}

      <details className="rounded-2xl bg-slate-50 p-3" open>
        <summary className="cursor-pointer text-xs font-bold text-slate-500">两个分身的对话（AI 代聊）</summary>
        <div className="mt-3 space-y-2">
          {match.transcript.map((t, i) => (
            <div key={i} className={`flex ${t.mine ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-6 ${t.mine ? "bg-qqBlue text-white" : "bg-white text-slate-700 shadow-sm"}`}>
                <span className="block text-[10px] opacity-70">{t.mine ? "你的分身" : `${other.nickname} 的分身`}</span>
                {t.text}
              </p>
            </div>
          ))}
        </div>
      </details>

      {onTeach && gaps.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-amber-50 p-3">
          <p className="text-xs font-black text-amber-800">你的分身在这里卡住了 · 替它补一句</p>
          {gaps.map((g) => (
            <GapAsk
              key={g.id}
              gap={g}
              otherName={other.nickname}
              onSubmit={async (text) => {
                const r = await onTeach(g.ask, text, match.id);
                if (r.added?.length) markDone(g.id);
                return r;
              }}
            />
          ))}
          <p className="text-[11px] leading-5 text-amber-700/80">只有你自己能看到这里。补的内容会进你的分身卡，配对对象能看到。</p>
        </div>
      )}

      {match.reasons.length > 0 && (
        <div className="text-xs leading-6 text-slate-500">
          <p className="font-bold text-slate-600">为什么配了你们</p>
          <ul>{match.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
        </div>
      )}

      {match.mutual ? (
        <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-black">你们都想认识对方 🎉</p>
          {other.wechat ? (
            <p className="mt-1">TA 的微信号：<b className="select-all">{other.wechat}</b></p>
          ) : (
            <p className="mt-1">TA 还没填微信号。你可以先在下面填好自己的，TA 填好后这里会出现。</p>
          )}
          {match.icebreakers.length > 0 && <p className="mt-2 text-xs text-emerald-700">开场可以试试：{match.icebreakers[0]}</p>}
        </div>
      ) : match.myChoice === "like" ? (
        <p className="rounded-2xl bg-sky-50 p-3 text-sm text-sky-700">已记下。如果 TA 也想认识你，这里会出现 TA 的微信号。</p>
      ) : match.myChoice === "skip" ? (
        <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">已跳过。<button type="button" onClick={() => choose("like")} className="font-bold text-qqBlue">改成想认识</button></p>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => choose("like")} className="flex-1 rounded-2xl bg-gradient-to-r from-qqBlue to-qqSky px-4 py-3 text-sm font-black text-white disabled:opacity-40">
            想认识
          </button>
          <button type="button" disabled={busy} onClick={() => choose("skip")} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-500 disabled:opacity-40">
            先不了
          </button>
        </div>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
      <button type="button" onClick={report} className="text-[11px] text-slate-400 underline-offset-2 hover:underline">
        举报并不再推荐
      </button>
    </article>
  );
}

function Settings({ me, onMe, onGone }) {
  const [nickname, setNickname] = useState(me.user.nickname || "");
  const [wechat, setWechat] = useState(me.user.wechat || "");
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState({ password: "", newPassword: "" });

  // 从顶部“设置”点进来时，等页面加载完再滚到这里
  useEffect(() => {
    if (window.location.hash === "#settings") document.getElementById("settings")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  async function saveNickname() {
    try {
      const res = await api("me", { method: "PATCH", body: { nickname } });
      onMe({ ...me, user: res.user });
      setNickname(res.user.nickname);
      setMsg("昵称已修改，下次登录请用新昵称");
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function saveWechat() {
    try {
      const res = await api("me", { method: "PATCH", body: { wechat } });
      onMe({ ...me, user: res.user });
      setMsg("微信号已保存");
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function changePassword() {
    try {
      await api("me", { method: "PATCH", body: pw });
      setPw({ password: "", newPassword: "" });
      setMsg("密码已修改");
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function removeAccount() {
    if (!window.confirm("注销后，你的分身卡、配对和所有记录都会被删除，不能恢复。确定注销？")) return;
    try {
      await api("me", { method: "DELETE" });
      onGone();
    } catch (e) {
      setMsg(e.message);
    }
  }

  const input = "min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-qqBlue";
  return (
    <section id="settings" className="scroll-mt-4 space-y-3 rounded-3xl bg-white p-5 text-sm shadow-sm">
      <h2 className="font-black text-slate-800">我的设置</h2>
      <div>
        <p className="text-xs text-slate-500">昵称（2 到 16 个字，不能和别人重复；登录时用新昵称）</p>
        <div className="mt-1 flex gap-2">
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} autoComplete="username" className={input} />
          <button type="button" disabled={!nickname.trim() || nickname.trim() === me.user.nickname} onClick={saveNickname} className="shrink-0 whitespace-nowrap rounded-2xl bg-qqBlue px-3 py-2 text-xs font-black text-white disabled:opacity-40">修改</button>
        </div>
      </div>
      <div>
        <p className="text-xs text-slate-500">微信号（只在双方都想认识后给对方看）</p>
        <div className="mt-1 flex gap-2">
          <input value={wechat} onChange={(e) => setWechat(e.target.value)} maxLength={40} className={input} />
          <button type="button" onClick={saveWechat} className="shrink-0 whitespace-nowrap rounded-2xl bg-qqBlue px-3 py-2 text-xs font-black text-white">保存</button>
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-slate-500">修改密码</summary>
        <div className="mt-2 space-y-2">
          <input type="password" placeholder="原密码" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} className={`${input} w-full`} />
          <input type="password" placeholder="新密码（至少 6 位）" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={`${input} w-full`} />
          <button type="button" onClick={changePassword} className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">改密码</button>
        </div>
      </details>
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
      <button type="button" onClick={removeAccount} className="text-xs font-bold text-rose-500">注销账号并删除数据</button>
    </section>
  );
}
