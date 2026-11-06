"use client";

// 人格卡 v2 的三个界面：三问引导、速通卡点选、确认页。流程见 skills/persona-card/user-flow.md。

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, categoryName, SHARED, updateItem, buildCard, todayISO } from "@/lib/socialState.mjs";
import { GUIDED_QUESTIONS } from "@/lib/agents.mjs";
import { STORE, loadSession, saveSession } from "./components";

const primaryBtn =
  "w-full rounded-[1.7rem] bg-gradient-to-r from-qqBlue to-qqSky px-5 py-4 text-base font-black text-white shadow-lg transition-transform duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtn = "w-full rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500";

// ---------- 三问引导 ----------

/**
 * @param {{ onDone: (answers: {question:number, answer:string, followup?:string, followupAnswer?:string}[]) => void, extraChips?: string[] }} props
 */
export function GuidedChat({ onDone, extraChips = [] }) {
  const saved = loadSession(STORE.onboarding);
  const [answers, setAnswers] = useState(saved?.answers || []);
  const [step, setStep] = useState(saved?.step ?? 0); // 当前题目下标
  const [followup, setFollowup] = useState(saved?.followup || ""); // 当前题目的追问（有就表示在等追问的回答）
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    saveSession(STORE.onboarding, { answers, step, followup });
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [answers, step, followup]);

  const q = GUIDED_QUESTIONS[step];
  const chips = q ? (step === 0 && extraChips.length ? extraChips : q.chips) : [];

  function finish(next) {
    saveSession(STORE.onboarding, null);
    onDone(next);
  }

  function advance(next) {
    setFollowup("");
    setDraft("");
    if (step + 1 >= GUIDED_QUESTIONS.length) finish(next);
    else setStep(step + 1);
  }

  async function submit(text, skipped = false) {
    const answer = String(text || "").trim();
    if (thinking || (!answer && !skipped)) return;
    if (followup) {
      const next = answers.map((a) => (a.question === q.id ? { ...a, followupAnswer: skipped ? "" : answer } : a));
      setAnswers(next);
      advance(next);
      return;
    }
    const next = [...answers.filter((a) => a.question !== q.id), { question: q.id, answer: skipped ? "" : answer }];
    setAnswers(next);
    setDraft("");
    if (skipped) {
      advance(next);
      return;
    }
    setThinking(true);
    try {
      const res = await fetch("/api/persona/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.id, answer, askedFollowup: false }),
      });
      const data = await res.json();
      if (data.action === "followup" && data.text) {
        setAnswers(next.map((a) => (a.question === q.id ? { ...a, followup: data.text } : a)));
        setFollowup(data.text);
      } else {
        advance(next);
      }
    } catch {
      advance(next);
    } finally {
      setThinking(false);
    }
  }

  // 已经聊过的内容，按顺序摊平成气泡
  const bubbles = [];
  GUIDED_QUESTIONS.slice(0, step + 1).forEach((item) => {
    const a = answers.find((x) => x.question === item.id);
    bubbles.push({ from: "claw", text: item.text });
    if (a) bubbles.push({ from: "me", text: a.answer || "（跳过）" });
    if (a?.followup) {
      bubbles.push({ from: "claw", text: a.followup });
      if (a.followupAnswer !== undefined) bubbles.push({ from: "me", text: a.followupAnswer || "（跳过）" });
    }
  });

  return (
    <section className="space-y-3">
      <p className="text-xs font-bold text-slate-400">第 {Math.min(step + 1, 3)} / 3 题</p>
      <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex ${b.from === "me" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[85%] rounded-[1.2rem] px-4 py-2 text-sm leading-6 ${
                b.from === "me" ? "bg-qqBlue text-white" : "bg-white text-slate-700 shadow-sm"
              }`}
            >
              {b.text}
            </p>
          </div>
        ))}
        {thinking && <p className="text-xs text-slate-400">claw在想…</p>}
        <div ref={bottom} />
      </div>

      {q && !followup && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c} type="button" disabled={thinking} onClick={() => submit(c)} className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-bold text-sky-700">
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit(draft)}
          placeholder={followup ? "回一句就行" : "随便说说"}
          maxLength={200}
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-qqBlue"
        />
        <button type="button" disabled={thinking || !draft.trim()} onClick={() => submit(draft)} className="rounded-2xl bg-qqBlue px-4 py-3 text-sm font-black text-white disabled:opacity-40">
          发送
        </button>
      </div>
      <button type="button" disabled={thinking} onClick={() => submit("", true)} className="text-xs font-bold text-slate-400">
        跳过这题
      </button>
    </section>
  );
}

// ---------- 速通卡 ----------

export function QuickPicker({ onDone, onBack }) {
  const [picked, setPicked] = useState([]);
  const [types, setTypes] = useState({});
  const [recent, setRecent] = useState("");

  function toggleCategory(id) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 5 ? cur : [...cur, id]));
  }
  function toggleType(cat, t) {
    setTypes((cur) => {
      const list = cur[cat] || [];
      return { ...cur, [cat]: list.includes(t) ? list.filter((x) => x !== t) : [...list, t] };
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm font-black text-slate-800">点 2 到 5 个你平时喜欢的</p>
        <p className="mt-1 text-xs text-slate-500">只给你的分身用，不会生成展示卡。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => toggleCategory(c.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${picked.includes(c.id) ? "border-qqBlue bg-qqBlue text-white" : "border-slate-200 bg-white text-slate-600"}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {picked.map((id) => {
        const cat = CATEGORIES.find((c) => c.id === id);
        return (
          <div key={id} className="rounded-2xl bg-white p-3">
            <p className="text-xs font-bold text-slate-500">{cat.name}：再细一点（可不选）</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cat.types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(id, t)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${(types[id] || []).includes(t) ? "bg-sky-100 text-sky-700" : "bg-slate-50 text-slate-500"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <input
        value={recent}
        onChange={(e) => setRecent(e.target.value)}
        placeholder="最近在玩/在看的（可不填）"
        maxLength={30}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-qqBlue"
      />
      <button type="button" disabled={picked.length < 2} onClick={() => onDone({ categories: picked, types, recent })} className={primaryBtn}>
        直接出发
      </button>
      <button type="button" onClick={onBack} className={ghostBtn}>
        返回
      </button>
    </section>
  );
}

// ---------- 确认页 ----------

const DISCLOSURE_LABEL = { public: "公开", match: "匹配可见", self_agent: "仅自己的分身" };

function interestLabel(i) {
  return i.entity || i.type || categoryName(i.category);
}

function VisibilitySelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
      {Object.entries(DISCLOSURE_LABEL).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

function ItemRow({ title, evidence, disclosure, onDisclosure, level, onLevel, onDelete, locked }) {
  return (
    <li className="rounded-2xl bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {evidence && evidence !== "点选" && <p className="mt-0.5 truncate text-xs text-slate-400">你说过：“{evidence}”</p>}
        </div>
        <button type="button" onClick={onDelete} className="shrink-0 text-xs font-bold text-slate-300 hover:text-rose-500" aria-label={`删除 ${title}`}>
          ✕
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {locked ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">仅自己的分身</span>
        ) : (
          <VisibilitySelect value={disclosure} onChange={onDisclosure} />
        )}
        {onLevel && (
          <label className="flex flex-1 items-center gap-2 whitespace-nowrap text-[11px] text-slate-400">
            热度
            <input type="range" min={1} max={10} value={level} onChange={(e) => onLevel(Number(e.target.value))} className="flex-1" />
            <span className="w-4 text-right font-bold text-slate-600">{level}</span>
          </label>
        )}
      </div>
    </li>
  );
}

/**
 * @param {{ persona: object, onChange: (p:object)=>void, onConfirm: (p:object)=>void, onPaste?: ()=>void, mode?: string }} props
 */
export function ConfirmView({ persona, onChange, onConfirm, onPaste }) {
  const state = persona.state;
  const rebuild = (nextState) => onChange(buildCard({ ...persona, state: nextState }));
  const edit = (kind, index, patch) => rebuild(updateItem(state, kind, index, patch));
  const pendingCount = ["interests", "situations", "skills"].reduce((n, k) => n + (state[k] || []).filter((x) => x.pending).length, 0);

  function resolvePending(toShared) {
    const fix = (list) => (list || []).map((x) => (x.pending ? { ...x, pending: false, disclosure: toShared ? "match" : x.disclosure } : x));
    rebuild({ ...state, interests: fix(state.interests), situations: fix(state.situations), skills: fix(state.skills) });
  }

  function confirm() {
    const cleared = {
      ...state,
      interests: (state.interests || []).map(({ pending, ...x }) => x),
      situations: (state.situations || []).map(({ pending, ...x }) => x),
      skills: (state.skills || []).map(({ pending, ...x }) => x),
    };
    const version = persona.confirmedAt ? (persona.version || 1) + 1 : persona.version || 1;
    onConfirm(buildCard({ ...persona, state: cleared, version, confirmedAt: todayISO() }));
  }

  // 只展开会给别人看的；“仅自己的分身”的折叠起来，犹豫型用户也能很快点完
  const split = (kind) => (state[kind] || []).map((x, index) => ({ x, index })).reduce(
    (acc, row) => (SHARED.has(row.x.disclosure) ? acc.shared.push(row) : acc.mine.push(row), acc),
    { shared: [], mine: [] }
  );
  const interests = split("interests");
  const situations = split("situations");
  const skills = split("skills");

  const renderInterest = ({ x, index }) => (
    <ItemRow
      key={`i-${index}`}
      title={`${interestLabel(x)}${x.entity && x.type ? ` · ${x.type}` : ""}`}
      evidence={x.evidence}
      disclosure={x.disclosure}
      onDisclosure={(d) => edit("interests", index, { disclosure: d })}
      level={x.level}
      onLevel={(l) => edit("interests", index, { level: l })}
      onDelete={() => edit("interests", index, null)}
    />
  );
  const renderSituation = ({ x, index }) => (
    <ItemRow key={`s-${index}`} title={x.text} evidence={x.evidence} disclosure={x.disclosure} onDisclosure={(d) => edit("situations", index, { disclosure: d })} onDelete={() => edit("situations", index, null)} />
  );
  const renderSkill = ({ x, index }) => (
    <ItemRow key={`k-${index}`} title={`会：${x.name}`} evidence={x.evidence} disclosure={x.disclosure} onDisclosure={(d) => edit("skills", index, { disclosure: d })} onDelete={() => edit("skills", index, null)} />
  );
  const mineCount = interests.mine.length + situations.mine.length + skills.mine.length;
  const removeWord = (kind, w) => rebuild({ ...state, [kind]: (state[kind] || []).filter((x) => x !== w) });

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm font-black text-slate-800">这是你的分身会用的信息</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">不想让别人看到的，改成“仅自己的分身”或直接删掉。每一条都来自你说过的话。</p>
      </div>

      {pendingCount > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p>从聊天记录里发现了 {pendingCount} 条新内容，要让匹配到的人看到吗？</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => resolvePending(true)} className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white">
              可以
            </button>
            <button type="button" onClick={() => resolvePending(false)} className="rounded-full border border-amber-300 px-3 py-1 text-xs font-bold text-amber-700">
              只给我的分身
            </button>
          </div>
        </div>
      )}

      <Group title="兴趣" empty="还没有兴趣，回去说一个最近在玩或在看的吧">{interests.shared.map(renderInterest)}</Group>
      {situations.shared.length > 0 && <Group title="近况">{situations.shared.map(renderSituation)}</Group>}
      {(skills.shared.length > 0 || state.wantsToLearn?.length > 0) && (
        <Group title="想学和会的">
          {skills.shared.map(renderSkill)}
          {(state.wantsToLearn || []).map((w) => (
            <WordRow key={`w-${w}`} text={`想学：${w}`} onDelete={() => removeWord("wantsToLearn", w)} />
          ))}
        </Group>
      )}
      {state.lookingFor && (
        <Group title="想认识谁">
          <li className="rounded-2xl bg-white p-3 text-sm text-slate-700 shadow-sm">{state.lookingFor}</li>
        </Group>
      )}

      <details className="rounded-2xl bg-white/70 p-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-600">只给我的分身（{mineCount + (state.avoid?.length || 0) + (state.style ? 1 : 0)} 条）</summary>
        <ul className="mt-3 space-y-2">
          {interests.mine.map(renderInterest)}
          {situations.mine.map(renderSituation)}
          {skills.mine.map(renderSkill)}
          {(state.avoid || []).map((w) => (
            <WordRow key={`a-${w}`} text={`不想聊：${w}`} onDelete={() => removeWord("avoid", w)} locked />
          ))}
          {state.style?.text && (
            <WordRow text={`说话风格：${state.style.text}`} onDelete={() => rebuild({ ...state, style: null })} locked />
          )}
        </ul>
      </details>

      {persona.thin && (
        <p className="rounded-2xl bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-700">
          信息还有点少：再说一个你最近在玩/在看的，分身开场会自然很多。
        </p>
      )}

      <button type="button" onClick={confirm} className={primaryBtn}>
        好了
      </button>
      {onPaste && (
        <button type="button" onClick={onPaste} className={ghostBtn}>
          贴聊天记录让它更像我
        </button>
      )}
    </section>
  );
}

function Group({ title, empty, children }) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{title}</p>
      {has ? <ul className="space-y-2">{children}</ul> : <p className="text-xs text-slate-400">{empty}</p>}
    </div>
  );
}

function WordRow({ text, onDelete, locked }) {
  return (
    <li className="flex items-center justify-between rounded-2xl bg-white p-3 text-sm text-slate-700 shadow-sm">
      <span>
        {text}
        {locked && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">仅自己的分身</span>}
      </span>
      <button type="button" onClick={onDelete} className="text-xs font-bold text-slate-300 hover:text-rose-500" aria-label={`删除 ${text}`}>
        ✕
      </button>
    </li>
  );
}
