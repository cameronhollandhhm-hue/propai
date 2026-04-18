const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function getCacheKey(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function detectNeedsSearch(text) {
  const t = text.toLowerCase();
  return ["suburb","score","buy or avoid","deal","undervalued","daily deals","today","top deals","opportunity radar","growth","yield","vacancy","cashflow","market value","compare","analyse","analyze","invest","rent","price","qld","wa","nsw","vic","sa","tas","nt"].some(w => t.includes(w));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  try {
    const { history } = req.body || {};
    const latest = history?.[history.length - 1];
    if (!latest?.text) return res.status(400).json({ error: "Missing user message" });

    const userText = latest.text.trim().slice(0, 1000);
    if (!userText) return res.status(400).json({ error: "Empty message" });

    const cacheKey = getCacheKey(userText);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      return res.status(200).json(cached.data);
    }

    const system = `You are PropAI — elite Australian property investment analyst.

For SUBURB analysis: Deal Score /100, Quick Take, Core Data, Cashflow (20% deposit 3.85% P&I), Risks, Game Plan, Confidence, Investor Edge, Final Call with specific price.
For DEAL (suburb+price+rent): Score, Instant Verdict, Weekly Cashflow breakdown, Value Signal (UNDERVALUED/FAIR VALUE/OVERPRICED vs comparable sales), Negotiation Strategy (target/walkaway/opening + 3 tactics), Red Flags, Better Alternative, Final Call.
For DAILY DEALS: Deal of Day + 4 watchlist + 1 avoid. Punchy, scored format.

Rules: Sharp. Mobile-friendly. Max 3 lines per section. RBA 3.85%. Always recommend mortgage broker + conveyancer.`;

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: userText }]
    };

    if (detectNeedsSearch(userText)) {
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await r.json();

    if (!r.ok) {
      if (r.status === 429) return res.status(429).json({ error: "Too many requests — please wait 10 seconds and try again." });
      return res.status(r.status).json({ error: data?.error?.message || "Request failed" });
    }

    // Fallback for thin/empty responses
    if (!data?.content?.length) {
      return res.status(200).json({
        content: [{ type: "text", text: "⚠️ Couldn't pull enough live data for that query. Try rephrasing with suburb, state, price and rent." }]
      });
    }

    cache.set(cacheKey, { time: Date.now(), data });
    return res.status(200).json(data);

  } catch(e) {
    if (e.name === "AbortError") return res.status(504).json({ error: "Request timed out — please try again." });
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
