import Link from "next/link";
import results from "@/experiments/speed-dating/results/results.json";

export const metadata = { title: "SocialQ · 匹配验证实验" };

const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "-");
const PENDING_LABEL = { L1: "大模型只看档案", L2_self: "分身代聊后自评", L2_judge: "档案 + 代聊裁判" };

// AUC 轴：0.4 – 0.8
const pos = (v) => `${Math.max(0, Math.min(100, ((v - 0.4) / 0.4) * 100))}%`;

// 分身卡方案：示例条目与四级披露
const CARD_SAMPLE = [
  { path: "音乐 / 独立音乐 / 草东没有派对", level: 8, evidence: "最近单曲循环草东", vis: "匹配可见" },
  { path: "近况 · 在备考，12 月底到期", level: null, evidence: "12 月底考试", vis: "匹配可见" },
  { path: "说话风格 · 句子短，爱用「哈哈」收尾", level: null, evidence: "来自粘贴的聊天记录", vis: "仅自己的分身" },
];
const DISCLOSURE = [
  ["公开", "展示卡上所有人可见", "用户主动打开才用"],
  ["匹配可见", "匹配后对方的分身和本人可见，用来找共同点", "引导对话里亲口说的兴趣、近况"],
  ["仅自己的分身", "只用来模仿说话方式，不拿去和别人对共同点", "粘贴记录抽出的条目、说话风格、不想聊的话题"],
  ["不存", "直接丢弃", "敏感信息，以及用户删掉的条目"],
];

export default function LabPage() {
  const arms = results.arms || [];
  return (
    <main className="min-h-screen bg-[#f4f8fc] px-4 py-8 font-display text-slate-800">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/" className="text-xs font-bold text-slate-500">← 返回 SocialQ</Link>

        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-qqBlue">SocialQ 实验室</p>
          <h1 className="mt-2 text-2xl font-black leading-tight text-slate-900">Agent 代聊，能预测两个真人合不合得来吗？</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            SocialQ 的核心假设是：让双方的 AI 分身先聊几句，就能判断真人是否值得认识。我们用公开的快速约会实验数据（{results.fullPopulation?.n} 对真实约会，
            标签是双方是否都选了“想再见面”）来检验这个假设，并和规则、机器学习基线对比。
          </p>
        </header>

        {results.mock && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            当前大模型组的结果来自演示模式（mock），数字没有意义，只说明流程跑通了。
          </p>
        )}

        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-base font-black">结论</h2>
          <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
            {results.conclusions.map((c) => <li key={c}>• {c}</li>)}
          </ul>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-black">各方法的 AUC</h2>
            <span className="text-xs text-slate-400">评测集 {results.n} 对 · 横线为 95% 置信区间</span>
          </div>
          <div className="mt-4 space-y-4">
            {arms.map((a) => (
              <div key={a.key}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-bold">{a.label} <span className="text-xs font-normal text-slate-400">{a.group}</span></span>
                  <span className="font-mono font-bold">{f3(a.auc)}</span>
                </div>
                <div className="relative mt-2 h-3 rounded-full bg-slate-100">
                  <div className="absolute top-0 h-3 w-px bg-slate-400" style={{ left: pos(0.5) }} title="随机水平 0.5" />
                  <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-sky-300" style={{ left: pos(a.lo), width: `calc(${pos(a.hi)} - ${pos(a.lo)})` }} />
                  <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-qqBlue" style={{ left: pos(a.auc) }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{a.desc}</p>
              </div>
            ))}
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>0.4</span><span>0.5 随机</span><span>0.6</span><span>0.7</span><span>0.8</span>
            </div>
          </div>
          {results.pending?.length > 0 && (
            <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-xs leading-6 text-slate-500">
              尚未运行：{results.pending.map((k) => PENDING_LABEL[k] || k).join("、")}。配置大模型密钥后运行 <code>npm run exp:llm</code> 和 <code>npm run exp:eval</code>。
            </p>
          )}
        </section>

        {results.deltas?.length > 0 && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-base font-black">关键对比</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr><th className="py-1 font-normal">问题</th><th className="py-1 text-right font-normal">AUC 差</th><th className="py-1 text-right font-normal">95% CI</th></tr>
              </thead>
              <tbody>
                {results.deltas.map((d) => (
                  <tr key={`${d.a}-${d.b}`} className="border-t border-slate-100">
                    <td className="py-2">{d.label}</td>
                    <td className="py-2 text-right font-mono">{d.delta >= 0 ? "+" : ""}{f3(d.delta)}</td>
                    <td className="py-2 text-right font-mono text-xs text-slate-500">{f3(d.lo)} – {f3(d.hi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="rounded-3xl bg-white p-5 text-sm leading-7 text-slate-600 shadow-sm">
          <h2 className="text-base font-black text-slate-800">分身卡方案</h2>
          <p className="mt-2">
            代聊能聊出什么，取决于分身手里有什么。上面的实验说明，只靠一份泛泛的档案很难判断两个人合不合得来。所以 SocialQ 的分身卡不追求“描述完整”，
            而是让每一条信息都<b>具体、有出处、知道能给谁看</b>。分身拿着这样的卡去聊，才能开出具体的话题，也不会替用户乱说。
          </p>

          <div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-3">
            <p className="text-xs text-slate-400">一张卡里的三条信息（示例）</p>
            {CARD_SAMPLE.map((c) => (
              <div key={c.path} className="rounded-xl bg-white px-3 py-2 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-bold text-slate-800">{c.path}</span>
                  <span className={`shrink-0 whitespace-nowrap rounded-full px-2 text-xs leading-6 ${c.vis === "匹配可见" ? "bg-sky-50 text-qqBlue" : "bg-slate-100 text-slate-500"}`}>{c.vis}</span>
                </div>
                <p className="text-xs text-slate-500">
                  原话：“{c.evidence}”{c.level ? ` · 热度 ${c.level}/10` : ""}
                </p>
              </div>
            ))}
          </div>

          <h3 className="mt-5 font-black text-slate-800">四个设计取舍</h3>
          <ul className="mt-1 space-y-2">
            <li>
              • <b>每条都带本人原话。</b>证据不超过 20 字，必须能在用户自己说的话里找到，找不到就不进卡。分身只能说卡上有出处的事，不推断用户没说的兴趣。
            </li>
            <li>
              • <b>兴趣拆到具体对象。</b>每条兴趣分三级：大类、类型、具体对象（音乐 / 独立音乐 / 草东没有派对）。两个人都“喜欢音乐”开不出话题，都在听同一支乐队才行。
            </li>
            <li>
              • <b>四级可见范围。</b>同一张卡，不同的人看到的不一样。给对方分身的内容在服务端过滤，不靠前端隐藏。
            </li>
            <li>
              • <b>三个问题就能生成。</b>引导对话约 2 分钟，可以再贴聊天记录让分身更像自己；原始记录不保存，对方的消息在抽取前丢掉。不想聊的用户可以点 2 到 5 个大类生成“速通卡”，它只给 AI 用，排在完整卡之后，对方会看到“TA 的分身信息较少”。
            </li>
          </ul>

          <table className="mt-4 w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr><th className="py-1 pr-2 font-normal">可见范围</th><th className="py-1 pr-2 font-normal">含义</th><th className="py-1 font-normal">默认用于</th></tr>
            </thead>
            <tbody>
              {DISCLOSURE.map(([name, meaning, usedFor]) => (
                <tr key={name} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap py-2 pr-2 font-bold text-slate-700">{name}</td>
                  <td className="py-2 pr-2">{meaning}</td>
                  <td className="py-2">{usedFor}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-4 text-xs text-slate-400">
            卡片只追加版本、不覆盖，近况到期自动失效。本页的实验用的是问卷生成的档案，还没有用分身卡；分身卡对配对效果的提升，要在真实用户里另行验证。
          </p>
        </section>

        <section className="rounded-3xl bg-white p-5 text-sm leading-7 text-slate-600 shadow-sm">
          <h2 className="text-base font-black text-slate-800">实验设计</h2>
          <ul className="mt-2 space-y-1">
            <li>• 数据：Fisman & Iyengar 等人的哥伦比亚大学快速约会实验，只用见面<b>之前</b>的报名问卷，见面打分和决定全部排除，防止标签泄漏。</li>
            <li>• 信息对等：规则、机器学习、大模型用的是同一份档案；刻意不使用种族、宗教、收入等敏感字段。</li>
            <li>• L1 和“档案 + 代聊裁判”的 prompt 只差代聊记录，两者之差就是代聊带来的增量信息。</li>
            <li>• 逻辑回归按活动场次做交叉验证，训练和测试的人来自不同场次。</li>
            <li>• 指标：AUC + 分层 bootstrap 置信区间（2000 次），方法之间做配对比较。</li>
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            局限：数据是美国研究生的异性快速约会，SocialQ 是中国年轻人交友，只能作代理验证；人格卡由问卷生成，本实验不验证“从聊天记录提炼人格”那一层。
            模型：{results.model || "尚未运行"}，生成于 {new Date(results.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。
          </p>
        </section>
      </div>
    </main>
  );
}
