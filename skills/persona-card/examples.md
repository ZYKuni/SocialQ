# 样例

## 样例 1:只走三问引导

**对话**

> 分身:最近在循环、在追或者在玩什么?随便说一两个就行
> 用户:在听歌，还在打星铁
> 分身:最近循环最多的是谁的歌?
> 用户:草东吧 最近单曲循环
> 分身:最近在忙什么，或者有什么想学、想试的?
> 用户:在备考 12月底考 考完想学做饭
> 分身:想认识什么样的人?有没有不太想被聊到的话题?
> 用户:能一起打游戏的 别问我考得怎么样哈哈

**抽取结果**

```json
{
  "version": 1,
  "createdAt": "2026-11-05",
  "confirmedAt": "2026-11-05",
  "thin": false,
  "selfIntro": "在备考，听草东打星铁",
  "lookingFor": "能一起打游戏的人",
  "interests": [
    { "category": "music", "type": "独立音乐", "entity": "草东没有派对", "level": 8, "recentAt": "2026-11-05", "evidence": "草东吧 最近单曲循环", "source": "guided", "disclosure": "match", "popularity": "unknown" },
    { "category": "games", "type": "抽卡手游", "entity": "崩坏：星穹铁道", "level": 7, "recentAt": "2026-11-05", "evidence": "还在打星铁", "source": "guided", "disclosure": "match", "popularity": "mid" }
  ],
  "situations": [ { "text": "在备考", "expiresAt": "2026-12-31", "evidence": "在备考 12月底考", "source": "guided", "disclosure": "match" } ],
  "skills": [],
  "wantsToLearn": [ "做饭" ],
  "dislikes": [],
  "avoid": [ "考试成绩" ],
  "style": { "text": "短句、不加标点，爱用「哈哈」收尾", "catchphrases": ["哈哈"], "confidence": 0.3, "disclosure": "self_agent" },
  "mbti": null,
  "extra": []
}
```

**要点**
- "星铁"用 `lexicon.json` 归一成"崩坏：星穹铁道",`popularity` 取词表里的 `mid`。
- "草东"不在词表里，保留全名并记 `unknown`。
- "别问我考得怎么样"进 `avoid`,不进 `dislikes`:他不是讨厌考试成绩，而是不想被问。
- 这次有 2 条带 entity 的兴趣，又有 1 条近况，所以 `thin` 是 false。

## 样例 2:粘贴聊天记录补充

用户在样例 1 之后贴了一段 QQ 群聊。经过隐私闸门后，剩下本人的 32 条消息，其中几条是:

> 周六又去爬香山了 腿废
> 谁有富士x100v的使用心得
> 我的手机号 [已脱敏] 加我
> 我们学校食堂今天又是土豆

**新增条目**(都是待确认，可见范围默认 `self_agent`)

```json
{
  "interests": [
    { "category": "outdoor", "type": "爬山徒步", "entity": "香山", "level": 7, "recentAt": "2026-11-05", "evidence": "周六又去爬香山了", "source": "chat_paste", "disclosure": "self_agent", "popularity": "unknown" },
    { "category": "art_craft", "type": "摄影", "entity": "富士X100V", "level": 6, "recentAt": null, "evidence": "谁有富士x100v的使用心得", "source": "chat_paste", "disclosure": "self_agent", "popularity": "unknown" }
  ]
}
```

**要点**
- 手机号已经被闸门脱敏，不产生条目。
- "我们学校食堂"涉及学校，不产生任何条目(H3)。
- 只有 32 条消息，不到 60 条，不推风格和 MBTI。
- 确认页会显示:"从聊天记录里发现了 2 条新兴趣，要让匹配到的人看到吗?"用户点"可以"之后，才改成 `match`。
