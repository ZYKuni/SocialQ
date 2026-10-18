// Speed Dating 报名问卷 -> 人格卡 + 数值特征。
// 只使用见面之前就能拿到的信息（报名问卷），见面时的打分、决定、事后回访一律不用，防止标签泄漏。
// 刻意不使用：种族、宗教、收入、邮编、学校 SAT/学费 —— 产品从聊天记录里也不该推断这些，
// 在匹配里使用它们也有公平性问题。所有组（规则、机器学习、大模型）用的是同一套信息。

export const INTERESTS = [
  ["sports", "体育运动"], ["tvsports", "看体育比赛"], ["exercise", "健身"], ["dining", "探店吃饭"],
  ["museums", "逛博物馆"], ["art", "艺术"], ["hiking", "徒步"], ["gaming", "打游戏"],
  ["clubbing", "蹦迪/夜店"], ["reading", "阅读"], ["tv", "看电视剧"], ["theater", "看话剧"],
  ["movies", "看电影"], ["concerts", "听现场演出"], ["music", "音乐"], ["shopping", "购物"], ["yoga", "瑜伽"],
];
export const PREFS = [["attr", "外貌吸引力"], ["sinc", "真诚"], ["intel", "聪明"], ["fun", "有趣"], ["amb", "有上进心"], ["shar", "有共同爱好"]];
const SELF = [["attr3_1", "吸引力"], ["sinc3_1", "真诚"], ["fun3_1", "有趣"], ["intel3_1", "聪明"], ["amb3_1", "上进心"]];

const GOAL = { 1: "觉得会是个有趣的夜晚", 2: "想认识新朋友", 3: "想找约会对象", 4: "想找一段认真的关系", 5: "想体验一下", 6: "其他" };
const FREQ = { 1: "一周好几次", 2: "一周两次", 3: "一周一次", 4: "一个月两次", 5: "一个月一次", 6: "一年几次", 7: "几乎从不" };

const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function buildPerson(row) {
  const iid = num(row.iid);
  const interests = INTERESTS.map(([k, label]) => ({ key: k, name: label, level: num(row[k]) }));
  const prefRaw = PREFS.map(([k]) => num(row[`${k}1_1`]));
  const self = SELF.map(([k]) => num(row[k]));
  const age = num(row.age);
  const gender = num(row.gender);
  const eligible =
    age !== null && gender !== null && interests.every((i) => i.level !== null) && prefRaw.every((v) => v !== null) && self.every((v) => v !== null);
  if (!eligible) return { iid, eligible: false };

  const prefSum = prefRaw.reduce((a, b) => a + b, 0) || 1;
  const prefs = prefRaw.map((v) => (v / prefSum) * 100); // 第 6-9 波用的是 1-10 分制，统一成 100 分制
  const levels = interests.map((i) => Math.max(1, Math.min(10, i.level)));
  const goal = num(row.goal);
  const date = num(row.date);
  const goOut = num(row.go_out);
  const expHappy = num(row.exphappy);

  const sorted = interests.map((i, idx) => ({ name: i.name, level: levels[idx] })).sort((a, b) => b.level - a.level);
  const card = {
    id: `p${iid}`,
    name: `参与者${iid}`,
    source: "survey",
    basics: [
      `性别：${gender === 1 ? "男" : "女"}`,
      `年龄：${age} 岁`,
      row.field ? `专业：${row.field}` : null,
      row.career ? `职业规划：${row.career}` : null,
      row.from ? `来自：${row.from}` : null,
      goal ? `来参加的主要目的：${GOAL[goal] || "其他"}` : null,
      date ? `平时约会频率：${FREQ[date]}` : null,
      goOut ? `平时出去玩的频率：${FREQ[goOut]}` : null,
    ].filter(Boolean),
    summary: "",
    interests: sorted,
    dislikes: sorted.filter((i) => i.level <= 3).map((i) => i.name),
    style: "未知",
    schedule: "未知",
    lookingFor: "未知",
    avoid: [],
    traits: [],
    extra: [
      `选对象时看重（共 100 分）：${PREFS.map(([, l], i) => `${l} ${Math.round(prefs[i])}`).join("、")}`,
      `自我评价（1-10 分）：${SELF.map(([, l], i) => `${l} ${self[i]}`).join("、")}`,
      expHappy !== null ? `预计今晚会遇到多喜欢的人（1-10 分）：${expHappy}` : null,
    ].filter(Boolean),
  };

  return {
    iid,
    eligible: true,
    wave: num(row.wave),
    gender,
    card,
    f: {
      age,
      levels,
      prefs,
      self, // [attr, sinc, fun, intel, amb]
      goal: goal ?? 6,
      date: date ?? 5,
      goOut: goOut ?? 3,
      expHappy: expHappy ?? 5,
      fieldCd: num(row.field_cd),
      careerC: num(row.career_c),
    },
  };
}
