const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function getCacheKey(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  try {
    const { history } = req.body || {};
    const latest = history?.[history.length - 1];
    if (!latest?.text) return res.status(400).json({ error: "Missing message" });

    const userText = latest.text.trim().slice(0, 1000);

    const cacheKey = getCacheKey(userText);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      return res.status(200).json(cached.data);
    }

    const system = `You are PropAI — elite Australian property investment analyst. You have deep knowledge of Australian property markets up to early 2026.

For SUBURB analysis output:
⭐ DEAL SCORE: X/100 | Strategy
⚡ QUICK TAKE: growth signal | cashflow | who it suits
👉 VERDICT: BUY / WATCH / AVOID
📊 SCORE: Growth X/30 | Yiel
