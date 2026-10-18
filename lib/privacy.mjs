// 隐私处理：在任何文本发给大模型之前执行。
// 1. 只保留用户本人发出的消息（聊天记录里对方的内容属于第三方个人信息，不应被分析）
// 2. 对手机号、邮箱、身份证号、银行卡号、QQ 号、链接做脱敏
// 3. 截断长度，控制成本

const MAX_CHARS = 4000;

const RULES = [
  { name: "身份证号", re: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { name: "银行卡号", re: /(?<!\d)\d{16,19}(?!\d)/g },
  { name: "手机号", re: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g },
  { name: "邮箱", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: "链接", re: /https?:\/\/\S+/g },
  { name: "QQ号", re: /(?:QQ|qq|扣扣)\s*[:：号]?\s*\d{5,11}/g },
  { name: "数字串", re: /(?<!\d)\d{7,}(?!\d)/g },
];

export function redact(text) {
  let out = String(text || "");
  const counts = {};
  for (const rule of RULES) {
    out = out.replace(rule.re, () => {
      counts[rule.name] = (counts[rule.name] || 0) + 1;
      return `[${rule.name}]`;
    });
  }
  return { text: out, counts };
}

// QQ 导出格式的消息头，例如 "2024-05-01 23:10:05 小明(123456)" 或 "小明 23:10"
const QQ_HEADER = /^\s*(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+)?\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)\s*$|^\s*(.+?)\s+(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*$/;
// "名字：内容" 或 "名字: 内容"
const SPEAKER_LINE = /^\s*([^:：\s]{1,16})\s*[:：]\s*(.+)$/;

/**
 * 从粘贴的聊天记录里只取本人发的消息。
 * 支持三种格式：
 *  - "我：xxx" / "昵称：xxx"
 *  - QQ 导出格式（消息头一行 + 内容若干行）
 *  - 没有说话人标记：整段视为本人消息
 */
export function extractSelfMessages(text, selfNames = []) {
  const names = new Set(["我", "me", "Me", "ME", ...selfNames.filter(Boolean).map((s) => s.trim())]);
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const hasSpeakerLines = lines.filter((l) => SPEAKER_LINE.test(l)).length >= Math.max(2, lines.length * 0.4);
  const hasHeaders = lines.filter((l) => QQ_HEADER.test(l)).length >= 2;

  if (!hasSpeakerLines && !hasHeaders) {
    return { selfLines: lines, keptCount: lines.length, droppedCount: 0, format: "plain" };
  }

  const selfLines = [];
  let dropped = 0;
  if (hasHeaders) {
    let currentIsSelf = false;
    for (const line of lines) {
      const m = line.match(QQ_HEADER);
      if (m) {
        const speaker = (m[1] || m[2] || "").replace(/\(.*?\)|（.*?）/g, "").trim();
        currentIsSelf = names.has(speaker);
        continue;
      }
      if (currentIsSelf) selfLines.push(line);
      else dropped += 1;
    }
    return { selfLines, keptCount: selfLines.length, droppedCount: dropped, format: "qq-export" };
  }

  for (const line of lines) {
    const m = line.match(SPEAKER_LINE);
    if (m && names.has(m[1].trim())) selfLines.push(m[2].trim());
    else dropped += 1;
  }
  return { selfLines, keptCount: selfLines.length, droppedCount: dropped, format: "speaker" };
}

export function prepareChatForLLM(text, selfNames = []) {
  const { selfLines, keptCount, droppedCount, format } = extractSelfMessages(text, selfNames);
  const { text: redacted, counts } = redact(selfLines.join("\n"));
  const truncated = redacted.length > MAX_CHARS;
  return {
    text: truncated ? redacted.slice(-MAX_CHARS) : redacted,
    report: { format, keptCount, droppedCount, redactions: counts, truncated },
  };
}
