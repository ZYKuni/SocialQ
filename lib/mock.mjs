// 演示模式：没有配置大模型密钥时使用的确定性“假模型”。
// 用关键词和兴趣重合度生成像样的输出，让 App 和实验脚本在离线环境也能完整跑通。
// 注意：mock 的输出没有任何预测意义，实验报告会明确标记。

import { interestOverlap, TRAIT_LABELS } from "./persona.mjs";
import { CATEGORIES, findLexiconEntities } from "./socialState.mjs";
import { mockGaps } from "./gaps.mjs";

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const INTEREST_RULES = [
  ["游戏", /游戏|王者|原神|lol|开黑|steam|switch|上分/i],
  ["电影", /电影|看片|影院|院线/],
  ["音乐", /音乐|听歌|演唱会|live|歌单/i],
  ["健身", /健身|跑步|撸铁|运动|游泳/],
  ["猫猫", /猫|喵/],
  ["美食", /火锅|奶茶|夜宵|烧烤|好吃|美食|宵夜/],
  ["写代码", /代码|bug|debug|编程|写程序/i],
  ["动漫", /动漫|番剧|二次元|漫画|追番/],
  ["旅行", /旅行|旅游|出去玩|机票/],
  ["篮球", /篮球|打球|NBA/i],
  ["追剧", /追剧|综艺|电视剧/],
  ["摄影", /拍照|摄影|相机|胶片/],
  ["阅读", /看书|小说|读书/],
];

const TRAIT_RULES = {
  搞怪值: /哈哈|笑死|绝了|离谱|整活|狗头/,
  真诚度: /谢谢|抱歉|认真|说实话|真的/,
  好奇心: /为什么|怎么|好奇|想试|？|\?/,
  梗感度: /yyds|破防|蚌埠|啊这|典|绝绝子|6{3,}|表情/i,
  夜猫子: /熬夜|凌晨|三点|两点|睡不着|通宵|夜宵|宵夜/,
  社交能量: /一起|出来|约|聚|走起|组队/,
};

function mockPersona({ chatText = "", nickname }) {
  const lines = chatText.split(/\n/).filter(Boolean);
  const interests = INTEREST_RULES.map(([name, re]) => {
    const n = lines.filter((l) => re.test(l)).length;
    return { name, level: Math.min(10, 6 + n), n };
  })
    .filter((i) => i.n > 0)
    .sort((x, y) => y.n - x.n)
    .slice(0, 6)
    .map(({ name, level }) => ({ name, level }));
  const traits = TRAIT_LABELS.map((label) => {
    const re = TRAIT_RULES[label];
    const hits = lines.filter((l) => re.test(l));
    return {
      label,
      score: Math.min(95, 45 + hits.length * 12),
      evidence: hits[0] ? hits[0].slice(0, 20) : "证据不足",
    };
  });
  const top = [...traits].sort((a, b) => b.score - a.score).slice(0, 2).map((t) => t.label);
  const likes = interests.slice(0, 3).map((i) => i.name);
  return JSON.stringify({
    summary: `${likes.length ? `爱${likes.join("、")}` : "兴趣还在探索中"}，${top.join("和")}都挺高的人`,
    interests: interests.length ? interests : [{ name: "聊天", level: 7 }],
    style: traits[0].score > 60 ? "轻松爱开玩笑，常用语气词" : "简洁直接",
    schedule: traits[4].score > 60 ? "经常熬夜" : "未知",
    lookingFor: likes.length ? `可能想认识也喜欢${likes[0]}的朋友` : "未知",
    avoid: [],
    traits,
    nickname,
  });
}

function topInterest(card, exclude = []) {
  const sorted = [...(card.interests || [])].sort((a, b) => b.level - a.level);
  return (sorted.find((i) => !exclude.includes(i.name)) || sorted[0] || { name: "聊天" }).name;
}

function levelOf(card, name) {
  const hit = (card.interests || []).find((i) => i.name === name || i.name.includes(name) || name.includes(i.name));
  return hit ? hit.level : 0;
}

// 速通卡热度都是 6，按 6 的门槛算重合（和 /api/match 的粗筛一致）；旧卡没有 tier，行为不变
const minLevelFor = (a, b) => ({ minLevel: a?.tier === "quick" || b?.tier === "quick" ? 6 : 7 });

function mockTurn({ self, other, turn }) {
  const { shared } = interestOverlap(self, other, minLevelFor(self, other));
  if (self.tier === "quick" && turn === 0) return `嗨～我是${self.name}的claw，我主人平时也会关注${topInterest(self)}这类，你家主人最近在玩什么？`;
  const mine = topInterest(self);
  const second = topInterest(self, [mine]);
  const theirs = topInterest(other);
  switch (turn) {
    case 0:
      return `嗨～我是${self.name}的claw，我主人最近沉迷${mine}，你家主人平时都爱干点啥？`;
    case 1:
      return levelOf(self, theirs) >= 7
        ? `${theirs}我也超爱！我主人空闲基本都在${theirs}，最近还迷上了${second}。`
        : `${theirs}我不太懂哈哈，我主人更喜欢${mine}，你那边对${mine}感兴趣吗？`;
    case 2:
      return levelOf(self, theirs) >= 7
        ? `太好了，终于遇到同好！${second}也可以一起聊聊，你平时一般几点睡？`
        : `${theirs}没怎么接触过，听起来挺有意思，有入门推荐吗？`;
    case 3:
      return shared.length
        ? `我们俩在${shared.slice(0, 2).join("和")}上都挺合拍的，下次可以一起约～`
        : `可以先从最简单的开始试试～不过感觉我们爱好差得有点多。`;
    case 4:
      return shared.length ? `今天聊得很开心，让主人们自己接着聊吧！` : `今天也算认识了个新朋友，有缘再聊～`;
    default:
      return shared.length ? `同意！我去跟我主人说一声～` : `好哒，祝你玩得开心～`;
  }
}

function mockProb(a, b, salt) {
  const { score } = interestOverlap(a, b, minLevelFor(a, b));
  const noise = hash(`${a.id}|${b.id}|${salt}`) * 30 - 15;
  return Math.max(3, Math.min(97, Math.round(25 + score * 90 + noise)));
}

function mockJudge({ a, b, transcript }) {
  const { shared } = interestOverlap(a, b, minLevelFor(a, b));
  const salt = transcript ? "chat" : "direct";
  return JSON.stringify({
    a_wants_b: mockProb(a, b, `${salt}-ab`),
    b_wants_a: mockProb(b, a, `${salt}-ba`),
    reasons: shared.length ? [`都喜欢${shared.slice(0, 2).join("和")}`, "聊天节奏接得上"] : ["兴趣重合不多", "但彼此都愿意聊新话题"],
    risks: shared.length ? ["作息可能不同步"] : ["共同话题需要慢慢找"],
    icebreakers: shared.length
      ? [`听说你也喜欢${shared[0]}？最近有什么推荐吗`, `我的claw说我们都是${shared[0]}党，认识一下～`]
      : [`你的claw说你喜欢${topInterest(b)}，能给新手推荐一下吗？`, "刚看完两个AI替我们尬聊，还是真人来打个招呼吧哈哈"],
  });
}

// ---------- 人格卡 v2 的演示分支 ----------

const CATEGORY_WORDS = [
  ["music", /听歌|音乐|歌单|演唱会/],
  ["games", /游戏|开黑|上分|打游戏/],
  ["film_tv", /追剧|电影|看片|美剧|韩剧|综艺/],
  ["acg", /番|动漫|二次元|漫画/],
  ["sports_play", /健身|跑步|撸铁|游泳|运动/],
  ["outdoor", /爬山|徒步|露营|滑雪/],
  ["reading", /看书|读书|小说/],
  ["food", /探店|火锅|咖啡|做饭|烘焙/],
  ["travel", /旅行|旅游/],
  ["art_craft", /摄影|拍照|画画|看展/],
];

function lineWith(text, word) {
  const line = text.split(/\n/).find((l) => l.includes(word)) || "";
  const at = Math.max(0, line.indexOf(word) - 6);
  return line.slice(at, at + 20).trim();
}

function mockFollowup({ question, answer = "" }) {
  const next = JSON.stringify({ action: "next", text: "" });
  const ask = (text) => JSON.stringify({ action: "followup", text });
  if (question === 1) {
    const hits = findLexiconEntities(answer);
    if (hits.length >= 2) return next;
    if (hits.length === 1) return ask("这是最近才入坑的还是老粉了？");
    if (/歌|音乐/.test(answer)) return ask("最近循环最多的是谁的歌？");
    if (/剧|番|电影|看/.test(answer)) return ask("最近看的哪一部？");
    if (/游戏|玩/.test(answer)) return ask("最近在玩哪款？");
    return answer.length >= 6 ? next : ask("能说一个具体的吗？比如最近在看或在玩的");
  }
  if (question === 2) {
    if (/考|备考/.test(answer) && !/\d|月|下周|明年|年底/.test(answer)) return ask("大概什么时候考完？");
    if (/想学|想试/.test(answer) && !/基础|学过|会一点/.test(answer)) return ask("有基础吗？");
    return next;
  }
  const wants = /想认识|搭子|朋友|一起|同行|都行/.test(answer);
  const avoids = /不想|别|不要|没有/.test(answer);
  if (wants && avoids) return next;
  return ask(wants ? "有不想被问到的话题吗？没有就算了" : "想认识什么样的人呀？");
}

function mockState({ userText = "", today, withTraits }) {
  const text = String(userText);
  const interests = [];
  const levelFor = (ev) => (/循环|每天|老粉|入坑/.test(ev) ? 8 : /在追|最近|挺喜欢/.test(ev) ? 7 : 6);
  const covered = new Set();
  for (const hit of findLexiconEntities(text)) {
    const evidence = lineWith(text, hit.matched);
    interests.push({ category: hit.category, type: null, entity: hit.canonical, level: levelFor(lineWith(text, hit.matched)), recentAt: /最近|这周|在追|在玩|在打/.test(evidence) ? today : null, evidence });
    covered.add(hit.category);
  }
  for (const [category, re] of CATEGORY_WORDS) {
    const m = text.match(re);
    if (!m || covered.has(category) || text.includes(`想学${m[0]}`)) continue;
    const cat = CATEGORIES.find((c) => c.id === category);
    const type = cat.types.find((t) => t.length >= 2 && text.includes(t)) || null;
    interests.push({ category, type, entity: null, level: 6, recentAt: null, evidence: lineWith(text, m[0]) });
  }
  const situations = [];
  const sit = text.match(/备考|考研|考公|实习|找工作|换工作|搬家|出差/);
  if (sit) {
    const month = text.match(/(\d{1,2})\s*月(底|初|中)?/);
    let expiresAt = null;
    if (month) {
      const year = Number(today.slice(0, 4)) + (Number(month[1]) < Number(today.slice(5, 7)) ? 1 : 0);
      const day = month[2] === "初" ? 5 : month[2] === "中" ? 15 : 28;
      expiresAt = `${year}-${String(month[1]).padStart(2, "0")}-${day}`;
    }
    situations.push({ text: `在${sit[0].replace(/^在/, "")}`, expiresAt, evidence: lineWith(text, sit[0]) });
  }
  const wantsToLearn = [...text.matchAll(/想学(?:一下|点)?([^\s，,。！!？?、]{1,6})/g)].map((m) => m[1]);
  const avoid = [...text.matchAll(/(?:别问我?|不想聊|不想被问|不要问)([^\s，,。！!？?]{1,10})/g)].map((m) => m[1].replace(/[了的吧哈]+$/, ""));
  const lookingLine = text.split(/\n/).find((l) => /想认识|搭子|朋友|一起|同行/.test(l)) || "";
  const catch_ = text.match(/哈哈+|笑死|绝了|离谱|破防了/);
  const names = interests.filter((i) => i.entity).map((i) => i.entity).slice(0, 2);
  const out = {
    selfIntro: [situations[0]?.text, names.length ? `喜欢${names.join("和")}` : ""].filter(Boolean).join("，").slice(0, 40),
    lookingFor: lookingLine.split(/[，,。\s]/)[0].slice(0, 30),
    interests,
    situations,
    skills: [],
    wantsToLearn,
    dislikes: [],
    avoid,
    style: { text: text.length / Math.max(1, text.split(/\n/).length) < 14 ? "句子短，口语化" : "愿意多说几句", catchphrases: catch_ ? [catch_[0]] : [], confidence: 0.3 },
  };
  if (withTraits) out.traits = JSON.parse(mockPersona({ chatText: text })).traits;
  return JSON.stringify(out);
}

export function mockComplete(tag, ctx) {
  switch (tag) {
    case "persona_followup":
      return mockFollowup(ctx);
    case "persona_state":
      return mockState(ctx);
    case "persona_extract":
      return mockPersona(ctx);
    case "agent_turn":
      return mockTurn(ctx);
    case "self_assess":
      return JSON.stringify({ probability: mockProb(ctx.self, ctx.other, "self"), reason: "（演示模式）根据兴趣重合度估计" });
    case "judge_chat":
    case "judge_direct":
      return mockJudge(ctx);
    case "find_gaps":
      return mockGaps(ctx);
    default:
      return "{}";
  }
}
