// 演示用的候选用户池：全部是虚构人物、均为成年人。
// 真实产品里这里应该是“同样开通了 claw、并授权参与匹配”的用户。

import { normalizePersona } from "./persona.mjs";

const RAW = [
  {
    id: "xiaoman", name: "小满", emoji: "🐰", color: "from-[#ffb6d9] to-[#ff8fab]",
    summary: "追番选手，猫猫表情包收藏家，深夜食堂常驻",
    interests: [{ name: "动漫", level: 9 }, { name: "猫猫", level: 9 }, { name: "美食", level: 8 }, { name: "手账", level: 7 }, { name: "游戏", level: 6 }],
    style: "爱用阴阳怪气的猫猫图，句尾常带“喵”", schedule: "经常两三点才睡", lookingFor: "能一起追番、半夜分享表情包的朋友", avoid: ["相亲", "考公"],
    traits: [["搞怪值", 85], ["真诚度", 70], ["好奇心", 72], ["梗感度", 92], ["夜猫子", 90], ["社交能量", 55]],
  },
  {
    id: "alex", name: "Alex", emoji: "😼", color: "from-[#6ed6ff] to-[#12a4ff]",
    summary: "球场和健身房两点一线，周末必开黑",
    interests: [{ name: "篮球", level: 9 }, { name: "健身", level: 8 }, { name: "游戏", level: 8 }, { name: "美食", level: 7 }],
    style: "直来直去，爱发语音", schedule: "早上 7 点起跑步", lookingFor: "能约球、能组队上分的朋友", avoid: [],
    traits: [["搞怪值", 60], ["真诚度", 80], ["好奇心", 50], ["梗感度", 65], ["夜猫子", 30], ["社交能量", 90]],
  },
  {
    id: "jules", name: "Jules", emoji: "🦊", color: "from-[#ffd66b] to-[#ff996e]",
    summary: "胶片摄影 + 说走就走的旅行，咖啡续命",
    interests: [{ name: "摄影", level: 9 }, { name: "旅行", level: 9 }, { name: "电影", level: 7 }, { name: "咖啡", level: 8 }],
    style: "文艺但不装，喜欢分享照片", schedule: "作息随旅行变化", lookingFor: "一起扫街拍照、交换旅行攻略的朋友", avoid: ["内卷话题"],
    traits: [["搞怪值", 45], ["真诚度", 78], ["好奇心", 90], ["梗感度", 50], ["夜猫子", 55], ["社交能量", 70]],
  },
  {
    id: "sam", name: "Sam", emoji: "🐯", color: "from-[#91f2cf] to-[#43c59e]",
    summary: "写代码的夜猫子，Steam 库存 300+，科幻迷",
    interests: [{ name: "写代码", level: 9 }, { name: "游戏", level: 9 }, { name: "阅读", level: 7 }, { name: "电影", level: 7 }],
    style: "话不多但梗很准", schedule: "凌晨两点还在 debug", lookingFor: "能一起熬夜写项目或打独立游戏的朋友", avoid: [],
    traits: [["搞怪值", 55], ["真诚度", 75], ["好奇心", 85], ["梗感度", 80], ["夜猫子", 92], ["社交能量", 40]],
  },
  {
    id: "nina", name: "Nina", emoji: "🐼", color: "from-[#d0c2ff] to-[#8ca6ff]",
    summary: "Livehouse 常客，歌单比朋友圈还长",
    interests: [{ name: "音乐", level: 9 }, { name: "追剧", level: 8 }, { name: "美食", level: 8 }, { name: "摄影", level: 6 }],
    style: "热情，爱发长语音和歌单链接", schedule: "周末夜里常在演出现场", lookingFor: "一起看演出、交换歌单的朋友", avoid: [],
    traits: [["搞怪值", 70], ["真诚度", 72], ["好奇心", 68], ["梗感度", 74], ["夜猫子", 75], ["社交能量", 88]],
  },
  {
    id: "owen", name: "Owen", emoji: "🐻", color: "from-[#baf28a] to-[#57c84d]",
    summary: "读书、徒步、听播客，周末在山里",
    interests: [{ name: "阅读", level: 9 }, { name: "徒步", level: 8 }, { name: "播客", level: 7 }, { name: "健身", level: 6 }],
    style: "慢热，认真回复每一条消息", schedule: "早睡早起", lookingFor: "能聊书、一起爬山的朋友", avoid: ["熬夜"],
    traits: [["搞怪值", 35], ["真诚度", 92], ["好奇心", 80], ["梗感度", 40], ["夜猫子", 15], ["社交能量", 45]],
  },
];

export const SAMPLE_POOL = RAW.map((r) => ({
  ...normalizePersona(
    { ...r, traits: r.traits.map(([label, score]) => ({ label, score, evidence: "（虚构示例用户）" })) },
    { id: r.id, name: r.name, source: "sample" }
  ),
  emoji: r.emoji,
  color: r.color,
}));

export function publicProfile(card) {
  const { id, name, emoji, color, summary, interests } = card;
  return { id, name, emoji, color, summary, interests: interests.map((i) => i.name) };
}
