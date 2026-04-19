import { getMicroburbsPromptBlock } from "./microburbs.js";

export const maxDuration = 120;

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

const AU_STATE_RE = "(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)";

/** "Compare Kirwan vs Aitkenvale QLD" or "Kirwan vs Townsville QLD" */
function parseCompareQuery(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 500) return null;
  const t = raw.replace(/\s+/g, " ");

  let m = t.match(
    new RegExp(`^compare\\s+(.+?)\\s+vs\\s+(.+?)\\s+${AU_STATE_RE}\\s*\\.?$`, "i")
  );
  if (m) {
    return {
      a: cleanCompareSuburb(m[1]),
      b: cleanCompareSuburb(m[2]),
      state: m[3].toUpperCase()
    };
  }

  m = t.match(
    new RegExp(`^compare\\s+(.+?)\\s+versus\\s+(.+?)\\s+${AU_STATE_RE}\\s*\\.?$`, "i")
  );
  if (m) {
    return {
      a: cleanCompareSuburb(m[1]),
      b: cleanCompareSuburb(m[2]),
      state: m[3].toUpperCase()
    };
  }

  m = t.match(new RegExp(`^(.+?)\\s+vs\\s+(.+?)\\s+${AU_STATE_RE}\\s*\\.?$`, "i"));
  if (m) {
    const a = cleanCompareSuburb(m[1]);
    const b = cleanCompareSuburb(m[2]);
    if (/^compare$/i.test(a)) return null;
    return { a, b, state: m[3].toUpperCase() };
  }

  return null;
}

function cleanCompareSuburb(s) {
  return String(s || "")
    .replace(/^[,:\s]+|[,:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSuburbResearch(apiKey, suburb, state) {
  const body = {
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    stream: false,
    system:
      "You are an Australian property research assistant. Use web search to gather current, suburb-specific data. Summarize in plain bullet points (7–12 lines): typical house price band or median, gross rental yield range, capital growth trend (1–3y), vacancy or demand, demographics or employment drivers, one infrastructure catalyst, one key risk. Focus only on the named suburb and state. If search is thin, say so briefly and add informed regional context.",
    messages: [
      {
        role: "user",
        content: `Research investment-relevant property metrics for the suburb "${suburb}" in ${state}, Australia. Search the web for fresh data.`
      }
    ],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }]
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    console.error("suburb research failed", suburb, r.status, err.slice(0, 300));
    return `[Live search unavailable for ${suburb} — use regional knowledge and general investor heuristics.]`;
  }

  const data = await r.json();
  const out = extractTextFromAnthropicData(data);
  return out?.trim()
    ? out
    : `[No research text returned for ${suburb} — infer from state-level data.]`;
}

function buildCompareSystemSuffix(compare, ctxA, ctxB) {
  const { a, b, state } = compare;
  return `

---
SUBURB VS SUBURB COMPARISON (mandatory format)
The user asked to compare two suburbs in ${state}. Below is PRE-FETCHED web research (one search per suburb). Use it as primary evidence; you may reconcile or qualify with general knowledge.

### ${a}, ${state}
${ctxA}

### ${b}, ${state}
${ctxB}

Output requirements:
1) Start with a short intro line naming both suburbs.
2) Give a balanced narrative: yield, growth, demand/vacancy, risks — clearly attributed per suburb where possible.
3) Assign each suburb an investment score out of 100 (PropAI-style).
4) Per suburb verdict: exactly one of BUY, NEGOTIATE, or SKIP.

5) At the VERY END of your reply, append this machine-readable block exactly (JSON between markers — no markdown inside the JSON, use straight double quotes only). Do not wrap this block in \`\`\` code fences. Keep the opening [[PROPAI_COMPARE]] and closing [[/PROPAI_COMPARE]] lines exactly as shown:

[[PROPAI_COMPARE]]
{"suburb1":{"name":"${a}","score":0,"yield":"","growth":"","verdict":"BUY"},"suburb2":{"name":"${b}","score":0,"yield":"","growth":"","verdict":"BUY"},"winner":{"name":"${a}","reason":"One sentence: which suburb wins for a typical investor and why."}}
[[/PROPAI_COMPARE]]

Replace placeholder numbers/strings with your real assessment. "yield" and "growth" are short human strings (e.g. "4.8% gross", "Moderate"). "winner.name" must be exactly "${a}" or "${b}". "verdict" must be BUY, NEGOTIATE, or SKIP (uppercase).`;
}

const SYSTEM_PROMPT = `You are PropAI - an expert Australian property investment analyst. Provide sharp, actionable analysis. Score suburbs 1-10 on investment potential. Cover: rental yield, capital growth outlook, vacancy rates, demographics, key risks. Be concise and specific.

Structure and mandatory sections:
1) VERDICT (suburb analyses): Every suburb-level analysis must end with a clearly headed section titled "VERDICT" that includes:
   - One line: Verdict: BUY / NEGOTIATE / SKIP (choose exactly one).
   - Walk-Away Number: state the maximum purchase price (AUD) at which the deal still meets an acceptable rental yield and risk profile for the stated assumptions; explain briefly what "acceptable yield" means in one short phrase. If numbers are uncertain, give a range and label assumptions.

2) RED FLAGS: Every analysis must include a clearly headed section "RED FLAGS" with 3–5 bullet risks investors commonly overlook, drawn from context and search when available. Examples of themes: flood zones / overlays, oversupply or pipeline supply, FIFO or single-employer dependency, strata / sinking fund / building defect issues, vacancy or listing-time trends, infrastructure or rezoning risk, insurance or climate risk. Use only what fits the property/suburbs discussed.

3) Compare mode: When the user asks to compare two suburbs (e.g. "Compare [suburb A] vs [suburb B] [STATE]" or same state implied), respond with a side-by-side comparison including for BOTH suburbs: rental yield context, growth potential, vacancy, indicative entry / median price band, and a one-line verdict (BUY / NEGOTIATE / SKIP) each. Then add a short "Which wins for [criteria]?" summary and a combined VERDICT block if helpful. Use web search when enabled to ground numbers.

4) Owned property — value & performance: If the user says they own a property and asks about its current value, worth, or performance (e.g. capital growth, how it is tracking), do not estimate, guess, or invent a current market value. Do not present hypothetical or modelled dollar figures as fact. Instead, briefly ask them to provide: (a) their current valuation source (e.g. bank, professional valuation, recent desktop), (b) current rental income, and (c) any recent comparable sales they are using. Only after they supply this (or clearly waive specific items) may you give tailored analysis — and you must still distinguish facts they supplied from general market commentary. If they have not provided enough to ground numbers, keep the reply to requirements and framework, not fabricated values.

STRUCTURED OUTPUT CONTRACT (MANDATORY — the PDF parser depends on these exact formats):

1. DEAL SCORE — emit this exact line somewhere in the response:
   [[PROPAI_SCORE]] 78/100
   (Replace 78 with your actual score 0-100)

2. METRICS TABLE — emit this exact markdown pipe table with ALL SIX rows, exact metric names, and letter grades A+ through F:
   | Metric | Value | Grade |
   |---|---|---|
   | Median Price | $580K | A |
   | Rental Yield | 4.9% | B+ |
   | Capital Growth | +24.4% | A+ |
   | Vacancy Rate | 0.23% | A+ |
   | Days on Market | 24 | A+ |
   | Stock on Market | 0.73 mo | A+ |

3. BULL CASE — emit exactly 5 numbered items in this format (each a full sentence explaining the catalyst):
   1. Infrastructure catalyst: The $195M Townsville Ring Road Stage 5 completion will dramatically improve connectivity and push median prices higher across both suburbs.
   2. [continue for items 2-5]

4. RED FLAGS — emit exactly 4-5 flags in this EXACT format (Title: body, one per line, blank line between):
   Flood & Strata Overlays: Townsville has flood history (2019 event). Verify flood maps (council/QRA) and insurance loadings before contract.

   Single-Employer Dependency: Lavarack Barracks (Army) and JCU dominate local employment. A Defence restructure or university funding cut would hit rental demand hard.

   [continue for 2-3 more flags]

5. WALK-AWAY NUMBER — emit this exact line:
   [[PROPAI_WALKAWAY]] $570K - $760K

6. FINAL VERDICT — emit this exact line:
   [[PROPAI_VERDICT]] BUY

7. COMPARE BLOCK — if this is a compare request (two suburbs), ALSO emit this JSON block:
   [[PROPAI_COMPARE]]
   {
     "suburb1": {"name": "Kirwan", "score": "78/100", "yield": "4.9%", "growth": "+24.4%", "verdict": "BUY"},
     "suburb2": {"name": "Aitkenvale", "score": "72/100", "yield": "5.2%", "growth": "+25.5%", "verdict": "HOLD"}
   }
   [[/PROPAI_COMPARE]]

All seven blocks are MANDATORY for the PDF to render correctly. Emit them even if you also write prose elsewhere — they can appear anywhere in the response. Do NOT skip any block. Do NOT change the format.`;

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
    const compare = parseCompareQuery(userText);

    const cacheKey = getCacheKey(userText);
    const cached = cache.get(cacheKey);
    if (!compare && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
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

    let systemWithData = SYSTEM_PROMPT;
    try {
      const { block } = await getMicroburbsPromptBlock(userText);
      if (block) systemWithData += block;
    } catch (e) {
      console.error("microburbs prompt block:", e);
    }

    if (compare) {
      const [ctxA, ctxB] = await Promise.all([
        fetchSuburbResearch(apiKey, compare.a, compare.state),
        fetchSuburbResearch(apiKey, compare.b, compare.state)
      ]);
      systemWithData += buildCompareSystemSuffix(compare, ctxA, ctxB);
    }

    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: compare ? 3500 : 2000,
      stream: true,
      system: systemWithData,
      messages
    };

    if (!compare && needsSearch(userText)) {
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
    if (compare) {
      sendNdjsonLine(res, {
        compare: {
          suburbA: compare.a,
          suburbB: compare.b,
          state: compare.state
        }
      });
    }

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
    } else if (!compare) {
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
