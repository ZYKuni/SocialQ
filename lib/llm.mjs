// OpenAI 兼容的大模型客户端（默认 DeepSeek）。
// App 的 API 路由和离线实验脚本共用这一个文件。
// 没有配置密钥时自动切换到 mock（演示模式），保证整条链路在离线环境也能跑通。

import { mockComplete } from "./mock.mjs";

export function getLLMConfig(env = process.env) {
  const apiKey = env.LLM_API_KEY || env.DEEPSEEK_API_KEY || "";
  const provider = (env.LLM_PROVIDER || (apiKey ? "openai-compatible" : "mock")).toLowerCase();
  return {
    provider,
    apiKey,
    baseURL: (env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, ""),
    model: env.LLM_MODEL || "deepseek-flash", // deepseek-chat 已于 2026-07-24 下线
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 60000),
    maxRetries: Number(env.LLM_MAX_RETRIES || 5),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseJSONLoose(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * @param {object} opts
 * @param {object} [opts.config]  getLLMConfig() 的结果
 * @param {object} [opts.cache]   { get(key), set(key, value) }，可选；实验脚本用磁盘缓存保证可复现、可断点续跑
 */
export function createLLM({ config = getLLMConfig(), cache = null } = {}) {
  const isMock = config.provider === "mock";
  const stats = { calls: 0, cachedCalls: 0, promptTokens: 0, completionTokens: 0, errors: 0 };

  async function rawCall({ messages, temperature, json, maxTokens }) {
    const body = {
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    };
    let lastError;
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetch(`${config.baseURL}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        } else if (!res.ok) {
          throw Object.assign(new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`), { fatal: true });
        } else {
          const data = await res.json();
          return {
            content: data.choices?.[0]?.message?.content ?? "",
            usage: {
              promptTokens: data.usage?.prompt_tokens ?? 0,
              completionTokens: data.usage?.completion_tokens ?? 0,
            },
          };
        }
      } catch (error) {
        clearTimeout(timer);
        if (error.fatal) throw error;
        lastError = error;
      }
      await sleep(Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500);
    }
    throw lastError;
  }

  /**
   * @param {object} p
   * @param {Array} p.messages
   * @param {number} [p.temperature]
   * @param {boolean} [p.json]      是否要求 JSON 输出
   * @param {number} [p.maxTokens]
   * @param {string} p.tag          任务类型，mock 模式据此生成对应输出
   * @param {object} [p.mockContext] mock 模式需要的结构化上下文（人格卡等），真实调用时忽略
   */
  async function chat({ messages: inputMessages, temperature = 0.7, json = false, maxTokens = 600, tag, mockContext }) {
    // DeepSeek 的 JSON 模式要求 prompt 里出现小写 "json"
    const messages =
      json && !inputMessages.some((m) => m.content.includes("json"))
        ? [...inputMessages.slice(0, -1), { ...inputMessages.at(-1), content: `${inputMessages.at(-1).content}\n（请只输出 json）` }]
        : inputMessages;
    const key = cache ? cache.keyOf({ model: isMock ? "mock" : config.model, messages, temperature, json, maxTokens }) : null;
    if (cache) {
      const hit = cache.get(key);
      if (hit) {
        stats.cachedCalls += 1;
        return { ...hit, cached: true };
      }
    }

    const started = Date.now();
    let result;
    if (isMock) {
      result = { content: mockComplete(tag, mockContext || {}), usage: { promptTokens: 0, completionTokens: 0 } };
    } else {
      try {
        result = await rawCall({ messages, temperature, json, maxTokens });
      } catch (error) {
        stats.errors += 1;
        throw error;
      }
    }

    let parsed = null;
    if (json) {
      parsed = parseJSONLoose(result.content);
      if (!parsed && !isMock) {
        // 解析失败时低温重试一次
        const retry = await rawCall({ messages, temperature: 0, json, maxTokens });
        result = { content: retry.content, usage: { promptTokens: result.usage.promptTokens + retry.usage.promptTokens, completionTokens: result.usage.completionTokens + retry.usage.completionTokens } };
        parsed = parseJSONLoose(result.content);
      }
      if (!parsed) {
        stats.errors += 1;
        throw new Error(`模型没有返回合法 JSON（tag=${tag}）：${String(result.content).slice(0, 200)}`);
      }
    }

    const out = { content: result.content, json: parsed, usage: result.usage, latencyMs: Date.now() - started };
    stats.calls += 1;
    stats.promptTokens += result.usage.promptTokens;
    stats.completionTokens += result.usage.completionTokens;
    if (cache) cache.set(key, out);
    return { ...out, cached: false };
  }

  return { chat, stats, isMock, model: isMock ? "mock" : config.model };
}
