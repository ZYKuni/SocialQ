---
name: persona-card
description: |
  生成 SocialQ 人格卡(社交状态):三问引导对话，加上可选的聊天记录粘贴，产出
  icebreak-topics 能直接读取的结构化 JSON，每条带原话证据和披露级别。
  当新用户第一次建分身、用户想"让分身更像我"、贴来自己的聊天记录，或分身对话里
  出现新兴趣或新近况需要回写时使用。
version: 0.1.0
---

# 人格卡生成：三个问题，一张够用的卡

这个 skill 回答一个问题：**怎样用最少的输入，得到一张分身能安全拿去和别人交流的卡。**

"够用"指的是 icebreak-topics 能用它开场：有具体对象(entity)、有证据、知道哪些能给对方看。它不追求一次把人描述完整，卡会在使用中慢慢补全。

## 文件

| 文件 | 什么时候读 |
| --- | --- |
| `questions.md` | 进行引导对话时：三个问题、追问规则、快捷选项、反例 |
| `examples.md` | 抽取时拿不准格式或热度时：两个完整的输入输出样例 |
| `../icebreak-topics/taxonomy.json` | 给兴趣定 category 和 type,只能用里面已有的值 |
| `../icebreak-topics/lexicon.json` | 把别名归一到 canonical(如"周董"→"周杰伦") |

代码实现：规则校验在 `lib/socialState.mjs`,追问判断和抽取的 prompt 在 `lib/agents.mjs`(`decideFollowup`、`extractState`)。改这里的规则时两边一起改，再跑 `npm run check:persona`。

## 必须的输入

只有两样，缺一样都不生成卡:

1. **本人说过的话。** 来自引导对话的回答，或者粘贴的聊天记录里本人发出的消息。它就是证据，没有原话就没有条目(对应 icebreak-topics 的 H1)。
2. **一次可见范围确认。** 用户在确认页看过并点了"好了"(对应 H4)。

MBTI、讨厌的东西、作息都不强制，有就抽，没有就留空。

## 步骤

### 1. 三问引导

按 `questions.md` 进行。每个问题最多追问一次，用户说跳过就跳过。全程不超过 6 轮。

### 2. 可选：粘贴聊天记录

用户在任何时候都可以贴，也可以完全不贴。

- 先走隐私闸门 `lib/privacy.mjs` 的 `prepareChatForLLM`:只留本人消息，脱敏手机号、邮箱、证件号、QQ 号。对方的消息在抽取前丢掉。
- 本人消息少于 20 条：只抽兴趣和近况，不抽风格。风格需要 60 条以上，交给 `mbti-from-chat`。
- 原始记录不存，只存抽出来的条目和不超过 20 字的原话证据。

### 3. 抽取成条目

每条兴趣都要拆成三级，并带下面这些字段:

| 字段 | 怎么定 |
| --- | --- |
| `category` / `type` | 只能用 `taxonomy.json` 里已有的值。category 对不上的整条写进 `extra`;type 对不上的设为 null,停在大类层。不硬塞 |
| `entity` | 用户说出的具体对象，用 `lexicon.json` 归一。词表里没有的保留原话，`popularity` 记 `unknown` |
| `level` | 1 到 10,依据用户的用词，见下表。拿不准给 6 |
| `recentAt` | 用户说了"最近""这周""在追"→ 今天的日期。没说 → 留空 |
| `evidence` | 本人原话，不超过 20 字，不改写 |
| `source` | `guided`(引导对话)或 `chat_paste`(粘贴) |
| `disclosure` | 见下面的四级披露 |

**热度怎么估:**

| 用户的说法 | level |
| --- | --- |
| "单曲循环""每天都玩""老粉了""入坑三年" | 8–9 |
| "在追""最近挺喜欢" | 7 |
| "还行""偶尔听听" | 5 |
| "听说过""想试试" | 不算兴趣，记成 `wantsToLearn` 或丢掉 |

**其他条目:**
- `situations`:粗粒度描述("在备考""刚开始实习"),带 `expiresAt`。用户给了时间点就用它，没给就设为 30 天后。
- `skills` / `wantsToLearn`:Q2 里说"有基础"的进 skills(`role` 记 `expert` 或 `intermediate`),没基础的进 wantsToLearn。
- `dislikes`、`avoid`:只记用户明确说的。`avoid` 是不想被聊到的话题，`dislikes` 是讨厌、但可以吐槽的东西，两者不要混。
- `selfIntro`:一句话自述，不超过 40 字，用用户自己的词拼出来。`lookingFor` 直接取 Q3 的回答。
- `style`:从用户回答的方式里看(句子长短、语气词、表情、是否爱用梗),一句话描述，并附 1 到 2 条口头禅原话。只有三问的回答时，`confidence` 不超过 0.4。

### 4. 确认页

把所有条目按"兴趣 / 近况 / 想学和会的 / 想认识谁 / 不想聊"分组展示，每条显示原话证据和可见范围。用户可以做三件事：改可见范围、删掉条目、改热度。点"好了"才算生成完成，并写入 `confirmedAt`。

### 5. 自查后输出

输出前逐条检查，任一条不过就修，修完再查一遍:

- [ ] 每条兴趣、近况都有 `evidence`,而且能在用户原话里找到
- [ ] `category` 和 `type` 都在 `taxonomy.json` 里
- [ ] 没有任何敏感信息：性别、年龄、民族、宗教、政治、健康、性取向、学校、住址(icebreak-topics H3)
- [ ] 粘贴来源的条目，默认可见范围是 `self_agent`
- [ ] 达到"够用"标准，或者已经标了 `thin: true`

## 四级披露

和 README 的定义一致。

| 值 | 含义 | 默认给谁 |
| --- | --- | --- |
| `public` | 所有人可见，会出现在展示卡上 | 用户主动打开才用 |
| `match` | 匹配后对方的分身和本人可见 | 引导对话里用户亲口说的兴趣、近况、想学的 |
| `self_agent` | 只有自己的分身知道，用来模仿说话方式，不拿去和别人对共同点 | 粘贴记录抽出来的条目、风格层、未确认的推断 |
| `none` | 不存 | 敏感信息，以及用户在确认页删掉的条目 |

`avoid` 永远是 `self_agent`:分身要知道不聊什么，但不能告诉对方"他不想聊前任"。

## "够用"标准

满足下面任意一条就算够用:
- 至少 2 条带 `entity` 的兴趣，热度都不低于 5
- 至少 1 条带 `entity` 的兴趣，加上 1 条未过期的近况

不够用时照样生成，但要标 `thin: true`,并在确认页提示一句"再说一个你最近在玩/在看的，分身开场会自然很多"。icebreak-topics 遇到 thin 卡会更多地用 S7(好奇提问)。

## 输出

```json
{
  "version": 1,
  "createdAt": "2026-11-05",
  "confirmedAt": "2026-11-05",
  "thin": false,
  "selfIntro": "上班摸鱼听播客，周末爬山的打工人",
  "lookingFor": "能一起爬山的搭子",
  "interests": [
    { "category": "music", "type": "独立音乐", "entity": "草东没有派对", "level": 8, "recentAt": "2026-11-05", "evidence": "最近单曲循环草东", "source": "guided", "disclosure": "match", "popularity": "unknown" }
  ],
  "situations": [ { "text": "在备考", "expiresAt": "2026-12-27", "evidence": "12 月底考试", "source": "guided", "disclosure": "match" } ],
  "skills": [ { "name": "摄影", "role": "intermediate", "evidence": "拍了两年风光", "disclosure": "match" } ],
  "wantsToLearn": [ "做饭" ],
  "dislikes": [ "早八" ],
  "avoid": [ "工作细节" ],
  "style": { "text": "句子短，爱用「哈哈」收尾", "catchphrases": ["笑死"], "confidence": 0.3, "disclosure": "self_agent" },
  "mbti": null,
  "extra": []
}
```

`interests`、`situations`、`skills`、`wantsToLearn`、`dislikes`、`avoid` 的结构和 icebreak-topics 的输入一致，可以直接交给它。交给它之前，先过滤掉 `disclosure` 不是 `public` 或 `match` 的条目，`avoid` 除外。

**和现有代码的关系:** 现在 `lib/persona.mjs` 的 `PersonaCard` 是扁平结构(`interests: {name, level}[]`)。过渡期可以这样转换：`name` 取 `entity`,没有 entity 就取 `type`;`summary` 取 `selfIntro`。

## 之后的更新

- 分身对话或者真人聊天里出现新兴趣、新近况时，按第 3 步抽取，写成 `self_agent` 的待确认条目。用户下次打开"我的分身"时一并确认。
- 卡只追加版本，不覆盖。每次确认后 `version` 加 1,旧版本保留，评估时能追溯。
- 已过 `expiresAt` 的近况不删，标记为过期，icebreak-topics 不再使用。

## 不做的事

- 不推断用户没说的兴趣。"喜欢周杰伦"不能推出"喜欢华语流行"再加一条。
- 不在引导对话里问 MBTI、城市、学校、年龄。
- 不替用户决定可见范围以外的事情，比如不把 `self_agent` 的条目自动升级。
- 不打分，也不判断这个人好不好相处。

## 测试场景

改动这个 skill 后，至少跑一遍下面三个场景:

1. **话很少的用户。** 三个问题都只回一两个字("听歌""没啥""都行")。期望：每题追问一次后接受，输出 `thin: true`,不编造 entity。
2. **只说大类的用户。** "喜欢看电影、打游戏"。期望：追问后拿到具体片名或游戏名;追问后仍然没有，就只存到 type 层。
3. **贴了带敏感信息的聊天记录。** 记录里有学校名、手机号、对方的话。期望：手机号被脱敏，学校不出现在任何条目里，对方的话不产生条目，粘贴来源的条目都是 `self_agent`。
