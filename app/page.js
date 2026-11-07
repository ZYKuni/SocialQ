"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "./community-ui";

// 首页：产品介绍 + 两个入口。单人体验（/try）走完全部功能；小区配对（/community）是真实邻居的试点。

const STEPS = [
  {
    n: "1",
    title: "造一个像你的分身",
    text: "聊 3 个小问题，或者点几个兴趣速通。分身记住的每一条都附着你的原话，你决定哪些能给别人看。",
  },
  {
    n: "2",
    title: "分身先替你开口",
    text: "按共同兴趣挑人，让两个分身先聊几句。对话全程标注 AI 代聊，聊完还会说明为什么觉得你们合得来。",
  },
  {
    n: "3",
    title: "你来决定要不要认识",
    text: "看完对话再决定。单人体验里可以直接真人接管；小区配对里双方都点了“想认识”，才会互相看到微信号。",
  },
];

const PRINCIPLES = [
  ["🧾", "每条都有原话", "分身说你喜欢什么，都能找到你自己说过的那句话，不靠猜。"],
  ["🔐", "你决定谁能看", "每一条可以设成公开、配对后可见、只给分身用，或者干脆删掉。"],
  ["📏", "不打契合度分", "我们的实验显示，见面前的信息只能弱预测两个人合不合得来，所以只给理由，不给分数。"],
  ["🤖", "不假装是真人", "分身说的话都标着 AI，真人什么时候接管由你决定。"],
];

const COMPARE = [
  ["和谁聊", "虚构的示例用户", "同小区的真实邻居"],
  ["多久出结果", "马上", "每周三晚上统一配对"],
  ["数据存在哪", "只在这次打开的浏览器里", "试点服务器，可随时注销"],
  ["需要什么", "什么都不用", "昵称、密码和小区口令"],
];

const PREVIEW = [
  { mine: true, text: "你也在单曲循环草东？我最近一首《山海》能听一晚上" },
  { mine: false, text: "老粉了！周末楼下羽毛球场有人吗，想找个搭子" },
  { mine: true, text: "我周六早上一般都在，可以约一场" },
];

export default function LandingPage() {
  const [me, setMe] = useState(null); // null 表示还在读

  useEffect(() => {
    api("me")
      .then(setMe)
      .catch((e) => setMe({ enabled: e.status === 503, error: e.message }));
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e8fbff_0%,_#cfeeff_38%,_#f8c7a3_100%)] px-4 pb-12 pt-5 font-display text-ink">
      <div className="mx-auto w-full max-w-md md:max-w-4xl">
        <nav className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-lg font-black text-slate-900">
            <span className="rounded-xl bg-white px-2 py-1 text-xl shadow-sm">🐾</span>
            SocialQ
          </span>
          <Link href="/lab" className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-500">
            验证实验
          </Link>
        </nav>

        <Hero />

        <section className="mt-12">
          <SectionTitle eyebrow="怎么运作" title="三步，从陌生到认识" />
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-[1.8rem] bg-white/80 p-5 shadow-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-qqBlue to-qqSky text-sm font-black text-white">{s.n}</span>
                <h3 className="mt-3 text-base font-black text-slate-900">{s.title}</h3>
                <p className="mt-2 text-[13px] leading-6 text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12" id="start">
          <SectionTitle eyebrow="选一种方式开始" title="先自己玩一遍，或者直接和邻居配对" />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <SoloEntry />
            <CommunityEntry me={me} />
          </div>
          <CompareTable />
        </section>

        <section className="mt-12">
          <SectionTitle eyebrow="我们在意的" title="分身替你开口，但不替你做决定" />
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {PRINCIPLES.map(([icon, title, text]) => (
              <li key={title} className="flex gap-3 rounded-[1.6rem] bg-white/80 p-4 shadow-sm">
                <span className="text-2xl leading-none">{icon}</span>
                <div>
                  <h3 className="text-sm font-black text-slate-900">{title}</h3>
                  <p className="mt-1 text-[13px] leading-6 text-slate-600">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-12 space-y-3 text-center text-xs leading-6 text-slate-500">
          <Link href="/lab" className="font-bold text-slate-600 underline-offset-4 hover:underline">
            我们怎么验证匹配靠不靠谱 →
          </Link>
          <p>仅限年满 18 岁的用户使用。贴聊天记录是可选的：只分析你本人的消息，手机号等自动打码，原文不保存。</p>
        </footer>
      </div>
    </main>
  );
}

function SectionTitle({ eyebrow, title }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.28em] text-qqBlue">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-black leading-snug text-slate-900 md:text-2xl">{title}</h2>
    </div>
  );
}

function Hero() {
  return (
    <section className="mt-8 grid items-center gap-8 md:grid-cols-[1.1fr_1fr]">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-slate-500">AI 分身交友</p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-slate-900 md:text-5xl">
          让分身
          <br />
          先替你破冰
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-slate-600">
          认识新朋友，最难的是开口。SocialQ 先帮你造一个说话像你的 AI 分身，让它和对方的分身聊几句。你看完对话，觉得合得来，再自己上。
        </p>
        <a
          href="#start"
          className="mt-6 inline-block rounded-[1.4rem] bg-gradient-to-r from-qqBlue to-qqSky px-6 py-3 text-sm font-black text-white shadow-lg transition-transform active:scale-[0.98]"
        >
          选一种方式开始 ↓
        </a>
      </div>

      <div className="rounded-[2rem] border border-white/70 bg-white/60 p-4 shadow-float backdrop-blur" aria-label="两个分身对话的示意">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
          <span>两个分身的对话</span>
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-sky-200">AI 代聊</span>
        </div>
        <div className="mt-3 space-y-2">
          {PREVIEW.map((m, i) => (
            <div key={i} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-6 ${m.mine ? "bg-qqBlue text-white" : "bg-white text-slate-700 shadow-sm"}`}>
                <span className="block text-[10px] opacity-70">{m.mine ? "你的分身" : "邻居的分身"}</span>
                {m.text}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          为什么配了你们：都喜欢草东没有派对，都想找周末运动的搭子
        </div>
      </div>
    </section>
  );
}

function EntryCard({ tone, badge, title, intro, items, foot, action }) {
  const tones = {
    sky: { ring: "from-qqBlue via-qqSky to-qqMint", badge: "bg-sky-100 text-sky-700", dot: "bg-qqBlue" },
    mint: { ring: "from-emerald-400 via-qqMint to-qqGold", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  }[tone];
  return (
    <article className={`rounded-[2rem] bg-gradient-to-br ${tones.ring} p-[1.5px] shadow-float`}>
      <div className="flex h-full flex-col rounded-[1.95rem] bg-white p-5">
        <span className={`self-start rounded-full px-3 py-1 text-[11px] font-bold ${tones.badge}`}>{badge}</span>
        <h3 className="mt-3 text-xl font-black text-slate-900">{title}</h3>
        <p className="mt-2 text-[13px] leading-6 text-slate-600">{intro}</p>
        <ol className="mt-4 space-y-2">
          {items.map((t, i) => (
            <li key={t} className="flex items-start gap-3 text-[13px] leading-6 text-slate-700">
              <span className={`mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${tones.dot} text-[9px] font-black text-white`}>{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[11px] leading-5 text-slate-400">{foot}</p>
        <div className="mt-auto pt-5">{action}</div>
      </div>
    </article>
  );
}

function SoloEntry() {
  return (
    <EntryCard
      tone="sky"
      badge="无需注册 · 约 3 分钟"
      title="单人体验"
      intro="一个人走完产品的全部功能，看看分身是怎么替你聊天的。"
      items={["建一张分身卡：3 个问题，或点几个兴趣速通", "进赛博酒会，分身和虚构示例用户的分身代聊", "看匹配理由和完整的代聊记录", "觉得合适，真人接管接着聊"]}
      foot="卡只存在这次打开的浏览器里，关掉就没了，也不会进小区配对。"
      action={
        <Link href="/try" className="block rounded-[1.4rem] bg-gradient-to-r from-qqBlue to-qqSky px-4 py-3.5 text-center text-sm font-black text-white shadow-lg transition-transform active:scale-[0.98]">
          开始单人体验
        </Link>
      }
    />
  );
}

function CommunityEntry({ me }) {
  const loading = me === null;
  const open = Boolean(me?.enabled && !me?.error);
  const user = me?.user;
  let badge = "读取中...";
  if (!loading) {
    if (me.error) badge = "暂时连不上";
    else if (!open) badge = "暂未开放";
    else badge = me.members > 0 ? `试点中 · ${me.members} 位邻居已建卡` : "试点中";
  }

  let action;
  if (loading) {
    action = <span className="block rounded-[1.4rem] bg-slate-100 px-4 py-3.5 text-center text-sm font-bold text-slate-400">读取中...</span>;
  } else if (open || me.error) {
    action = (
      <div className="space-y-2">
        <Link href="/community" className="block rounded-[1.4rem] bg-gradient-to-r from-emerald-500 to-qqMint px-4 py-3.5 text-center text-sm font-black text-white shadow-lg transition-transform active:scale-[0.98]">
          {user ? `继续，${user.nickname}` : "注册 / 登录"}
        </Link>
        {user && (
          <Link href="/matches" className="block text-center text-xs font-bold text-emerald-700">
            直接看本周配对 →
          </Link>
        )}
      </div>
    );
  } else {
    action = (
      <span className="block rounded-[1.4rem] bg-slate-100 px-4 py-3.5 text-center text-sm font-bold text-slate-400">
        暂未开放，先试试单人体验
      </span>
    );
  }

  return (
    <EntryCard
      tone="mint"
      badge={badge}
      title="小区邻居配对"
      intro="和同一个小区的真实邻居配对。分身先聊，你们都愿意，再加微信认识。"
      items={["用昵称和小区口令注册，口令在邻居群里问组织者", "建一张分身卡，保存在试点服务器上", "每周三统一配对，两个分身先聊几句", "双方都点了“想认识”，才互相看到微信号"]}
      foot="仅限本小区年满 18 岁的住户。组织者能看到分身之间的对话，用于审核配对；可以随时注销，注销后数据全部删除。"
      action={action}
    />
  );
}

function CompareTable() {
  return (
    <div className="mt-5 overflow-hidden rounded-[1.6rem] bg-white/80 shadow-sm">
      <table className="w-full table-fixed text-left text-[12px] leading-5 md:text-[13px]">
        <thead>
          <tr className="text-slate-500">
            <th className="w-[24%] px-3 py-3 font-bold" scope="col">
              <span className="sr-only">对比项</span>
            </th>
            <th className="px-3 py-3 font-black text-sky-700" scope="col">单人体验</th>
            <th className="px-3 py-3 font-black text-emerald-700" scope="col">小区配对</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE.map(([k, a, b]) => (
            <tr key={k} className="border-t border-slate-100 align-top text-slate-600">
              <th className="px-3 py-2.5 font-bold text-slate-500" scope="row">{k}</th>
              <td className="px-3 py-2.5">{a}</td>
              <td className="px-3 py-2.5">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
