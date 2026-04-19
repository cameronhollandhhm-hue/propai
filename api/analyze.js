export const maxDuration = 60;

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function getCacheKey(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function needsSearch(text) {
  const t = text.toLowerCase();
  const triggers = ["suburb", "score", "deals", "undervalued", "yield", "postcode", "today", "current", "latest", "median", "rent", "vacancy"];
  const states = ["nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt"];
  return triggers.some(w => t.includes(w)) || states.some(s => t.includes(s));
}

const SYSTEM_PROMPT = `You are PropAI - an expert Australian property investment analyst. Provide sharp, actionable analysis. Score suburbs 1-10 on investment potential. Cover: rental yield, capital growth outlook, vacancy rates, demographics, key risks. Be concise and specific.`;

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
      return res.status(200).json(cached.data);
    }

    const messages = history.map(m => ({
      role: m.role,
      content: (m.text || m.content || "").slice(0, 1000)
    }));

    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages
    };

    if (needsSearch(userText)) {
      body.tools = [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3
      }];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (anthropicRes.status === 429) {
      return res.status(200).json({
        content: [{ type: "text", text: "⚠️ Busy right now — please try again in a minute." }]
      });
    }

    if (!anthropicRes.ok) {
      return res.status(200).json({
        content: [{ type: "text", text: "⚠️ Something went wrong. Try rephrasing with suburb + state + price + rent." }]
      });
    }

    const data = await anthropicRes.json();

    if (!data?.content?.length) {
      return res.status(200).json({
        content: [{ type: "text", text: "⚠️ Couldn't pull enough data. Try including suburb + state + price + rent." }]
      });
    }

    cache.set(cacheKey, { ts: Date.now(), data });
    return res.status(200).json(data);

  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(200).json({
        content: [{ type: "text", text: "⚠️ Analysis took too long. Try a more specific query like 'Score Townsville 4810 as investment'." }]
      });
    }
    console.error("analyze error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}