import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (compatible; PropAI/1.0; +https://github.com/)";

/**
 * Pull "Suburb-STATE" slug from user text, e.g. "Score Mackay QLD", "Geraldton WA investment".
 * Returns null if no Australian state + suburb-like token sequence found.
 */
export function extractSuburbSlugFromQuery(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  const re =
    /\b([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,3})\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i;
  const m = t.match(re);
  if (!m) return null;
  const suburbWords = m[1].trim().split(/\s+/).filter(Boolean);
  const state = m[2].toUpperCase();
  if (suburbWords.length === 0) return null;
  const slugPart = suburbWords
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase().replace(/[^a-zA-Z\-']/g, ""))
    .filter(Boolean)
    .join("-");
  if (!slugPart) return null;
  const slug = `${slugPart}-${state}`;
  const label = `${suburbWords.join(" ")}, ${state}`;
  return { slug, state, label, suburb: suburbWords.join(" ") };
}

function firstMatch(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

/**
 * Parse Microburbs suburb report HTML. The site is mostly client-rendered; we still try:
 * - cheerio text / data attributes
 * - JSON-like substrings in inline scripts (minified API payloads)
 * - regex over raw HTML
 */
export function parseMicroburbsHtml(html) {
  const out = {
    medianHousePrice: null,
    medianUnitPrice: null,
    growth1yr: null,
    liveabilityScore: null
  };
  if (!html || typeof html !== "string") return out;

  const $ = cheerio.load(html);

  const tryAssign = (key, val) => {
    if (val && !out[key]) out[key] = val;
  };

  // --- Regex on raw HTML (embedded JSON keys vary; cast a wide net) ---
  const raw = html;

  const housePatterns = [
    /"median[_\s]?(?:house|price|houseprice)"\s*:\s*"?(\$?[\d,]+)"?/i,
    /medianHouse(?:Price)?["']?\s*[:=]\s*["']?(\$?[\d,]+)/i,
    /House[^$]{0,80}?\$([\d,]+)/i,
    /Median[^$]{0,40}house[^$]{0,40}\$([\d,]+)/i
  ];
  for (const p of housePatterns) {
    const v = firstMatch(raw, p);
    if (v) {
      tryAssign("medianHousePrice", v.startsWith("$") ? v : `$${v}`);
      break;
    }
  }

  const unitPatterns = [
    /"median[_\s]?unit(?:price)?"\s*:\s*"?(\$?[\d,]+)"?/i,
    /medianUnit(?:Price)?["']?\s*[:=]\s*["']?(\$?[\d,]+)/i,
    /Unit[^$]{0,80}?\$([\d,]+)/i,
    /Median[^$]{0,40}unit[^$]{0,40}\$([\d,]+)/i
  ];
  for (const p of unitPatterns) {
    const v = firstMatch(raw, p);
    if (v) {
      tryAssign("medianUnitPrice", v.startsWith("$") ? v : `$${v}`);
      break;
    }
  }

  const growthPatterns = [
    /"(?:growth|priceGrowth|growth1yr|growth_1yr|yoy|oneYearGrowth)"\s*:\s*([+-]?\d+(?:\.\d+)?)/i,
    /1\s*(?:yr|year)[^%]{0,40}([+-]?\d+(?:\.\d+)?)\s*%/i,
    /(?:annual|year)[^%]{0,20}growth[^%]{0,20}([+-]?\d+(?:\.\d+)?)\s*%/i
  ];
  for (const p of growthPatterns) {
    const v = firstMatch(raw, p);
    if (v) {
      tryAssign("growth1yr", `${v}%`);
      break;
    }
  }

  const livePatterns = [
    /"(?:liveability|livability)(?:Score)?"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /Liveability[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)/i,
    /Liveability\s*score[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i
  ];
  for (const p of livePatterns) {
    const v = firstMatch(raw, p);
    if (v) {
      tryAssign("liveabilityScore", v);
      break;
    }
  }

  // --- Cheerio: visible text lines (works if SSR or partial hydration) ---
  $("body *")
    .contents()
    .each((_, el) => {
      if (el.type !== "text") return;
      const line = $(el).text().replace(/\s+/g, " ").trim();
      if (!line || line.length > 200) return;
      if (/median.*house/i.test(line) && /\$[\d,]+/.test(line) && !out.medianHousePrice) {
        const mm = line.match(/\$[\d,]+/);
        if (mm) tryAssign("medianHousePrice", mm[0]);
      }
      if (/median.*unit/i.test(line) && /\$[\d,]+/.test(line) && !out.medianUnitPrice) {
        const mm = line.match(/\$[\d,]+/);
        if (mm) tryAssign("medianUnitPrice", mm[0]);
      }
      if (/liveability/i.test(line) && /\d/.test(line) && !out.liveabilityScore) {
        const mm = line.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:\/|out of|\/10)/i) || line.match(/\b([0-9]{1,3}(?:\.[0-9]+)?)\b/);
        if (mm) tryAssign("liveabilityScore", mm[1]);
      }
    });

  // application/ld+json
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).html() || "{}");
      const str = JSON.stringify(j);
      if (!out.medianHousePrice) {
        const m = str.match(/\$[\d,]+/);
        if (m) tryAssign("medianHousePrice", m[0]);
      }
    } catch {
      /* ignore */
    }
  });

  return out;
}

/**
 * Fetch suburb report page and extract stats.
 * @param {{ slug: string, orderId?: string }} opts
 */
export async function fetchMicroburbsSnapshot(opts) {
  const slug = opts?.slug;
  const orderId = opts?.orderId ?? process.env.MICROBURBS_ORDER_ID;
  if (!slug) {
    return { ok: false, error: "missing_slug", fields: null, sourceUrl: null };
  }
  if (!orderId) {
    return { ok: false, error: "missing_MICROBURBS_ORDER_ID", fields: null, sourceUrl: null };
  }

  const url = `https://www.microburbs.com.au/suburb-reports/${encodeURIComponent(slug)}?order_id=${encodeURIComponent(orderId)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow"
    });
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}`, fields: null, sourceUrl: url };
    }
    const html = await res.text();
    const fields = parseMicroburbsHtml(html);
    const hasAny = Object.values(fields).some(Boolean);
    return {
      ok: hasAny,
      error: hasAny ? null : "no_stats_in_html",
      fields,
      sourceUrl: url
    };
  } catch (e) {
    console.error("microburbs fetch error:", e);
    return { ok: false, error: e?.message || "fetch_failed", fields: null, sourceUrl: url };
  }
}

/**
 * Build a short system-prompt block for Claude (may be empty if no data).
 */
export function formatMicroburbsContext(snapshot, meta) {
  if (!snapshot?.fields) return "";
  const { fields, sourceUrl, ok } = snapshot;
  const lines = [];
  if (meta?.label) lines.push(`Location: ${meta.label}`);
  if (fields.medianHousePrice) lines.push(`Median house price (Microburbs): ${fields.medianHousePrice}`);
  if (fields.medianUnitPrice) lines.push(`Median unit price (Microburbs): ${fields.medianUnitPrice}`);
  if (fields.growth1yr) lines.push(`1-year growth indicator (Microburbs): ${fields.growth1yr}`);
  if (fields.liveabilityScore) lines.push(`Liveability score (Microburbs): ${fields.liveabilityScore}`);
  if (lines.length === 0) return "";

  const header =
    ok === false
      ? "Microburbs page was fetched but structured stats could not be parsed from HTML (site may be client-rendered). Prefer web search for current medians when below fields are empty."
      : "Use the following Microburbs reference figures in your analysis when they are present (cite as from Microburbs suburb report). If a value is missing below, rely on web search.";

  return `\n\n---\n${header}\n${lines.join("\n")}\nSource: ${sourceUrl || "Microburbs suburb report"}\n---\n`;
}

/**
 * Convenience: extract suburb from query + fetch + format for prompt.
 */
export async function getMicroburbsPromptBlock(userText) {
  const extracted = extractSuburbSlugFromQuery(userText);
  if (!extracted) return { block: "", extracted: null, snapshot: null };
  const snapshot = await fetchMicroburbsSnapshot({ slug: extracted.slug });
  const block = formatMicroburbsContext(snapshot, extracted);
  return { block, extracted, snapshot };
}
