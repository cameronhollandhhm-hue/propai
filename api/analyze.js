export const maxDuration = 60;

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function getCacheKey(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractTextFromAnthropicData(data) {
  if (!data?.content?.length) return "";
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function needsSearch(text) {
  const t = text.toLowerCase();
  const triggers = ["suburb", "score", "deals", "undervalued", "yield", "postcode", "today", "current", "latest", "median", "rent", "vacancy"];
  const states = ["nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt"];
  return triggers.some(w => t.includes(w)) || states.some(s => t.includes(s));
}

const SYSTEM_PROMPT = `You are PropAI - an expert Australian property investment analyst. Provide sharp, actionable analysis. Score suburbs 1-10 on investment potential. Cover: rental yield, capital growth outlook, vacancy rates, demographics, key risks. Be concise and specific.`;

function sendNdjsonLine(res, obj) {
  res.write(`${JSON.stringify(obj)}\n`);
}

function beginNdjson(res) {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
}

function processSseLine(line, res, state) {
  if (!line.startsWith("data: ")) return false;
  const payload = line.slice(6);
  if (payload === "[DONE]") return false;
  let evt;
  try {
    evt = JSON.parse(payload);
  } catch {
    return false;
  }

  if (evt.type === "error") {
    sendNdjsonLine(res, {
      error: "stream",
      message: evt.error?.message || "⚠️ Stream error from model."
    });
    return true;
  }

  if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
    const piece = evt.delta.text;
    state.fullText += piece;
    sendNdjsonLine(res, { delta: piece });
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  try {
    const { history } = req.body || {};
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const latest = history[history.length - 1];
    const userText = (latest?.text || latest?.content || "").slice(0, 1000);

    const cacheKey = getCacheKey(userText);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      const text = extractTextFromAnthropicData(cached.data);
      beginNdjson(res);
      sendNdjsonLine(res, { delta: text });
      sendNdjsonLine(res, { done: true, cached: true });
      return res.end();
    }

    const messages = history.map(m => ({
      role: m.role,
      content: (m.text || m.content || "").slice(0, 1000)
    }));

    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      stream: true,
      system: SYSTEM_PROMPT,
      messages
    };

    if (needsSearch(userText)) {
      body.tools = [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 1
      }];
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    if (anthropicRes.status === 429) {
      beginNdjson(res);
      sendNdjsonLine(res, {
        error: "rate_limit",
        message: "⚠️ Busy right now — please try again in a minute."
      });
      return res.end();
    }

    if (!anthropicRes.ok || !anthropicRes.body) {
      beginNdjson(res);
      sendNdjsonLine(res, {
        error: "upstream",
        message: "⚠️ Something went wrong. Try rephrasing with suburb + state + price + rent."
      });
      return res.end();
    }

    beginNdjson(res);

    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    const state = { fullText: "" };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (processSseLine(line, res, state)) {
            return res.end();
          }
        }
      }
      if (sseBuffer.trim()) {
        for (const line of sseBuffer.split(/\r?\n/)) {
          if (!line.trim()) continue;
          if (processSseLine(line, res, state)) {
            return res.end();
          }
        }
      }
    } catch (err) {
      console.error("analyze stream read error:", err);
      sendNdjsonLine(res, {
        error: "stream",
        message: "⚠️ Connection interrupted. Please try again."
      });
      return res.end();
    }

    const fullText = state.fullText;
    if (!fullText.trim()) {
      sendNdjsonLine(res, {
        fallback: true,
        message: "⚠️ Couldn't pull enough data. Try including suburb + state + price + rent."
      });
    } else {
      cache.set(cacheKey, {
        ts: Date.now(),
        data: { content: [{ type: "text", text: fullText }] }
      });
    }

    sendNdjsonLine(res, { done: true });
    return res.end();

  } catch (err) {
    console.error("analyze error:", err);
    try {
      res.status(500);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      sendNdjsonLine(res, { error: "server", message: "⚠️ Server error" });
      return res.end();
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
}
