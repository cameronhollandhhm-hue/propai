import { jsPDF } from "jspdf";
/* ============================================================================
 * PROPAI PDF REPORT GENERATOR
 * ----------------------------------------------------------------------------
 * Single-file PDF builder. All parsing happens up front and produces clean
 * strings (no markdown, no asterisks). Draw functions trust their input.
 * ========================================================================== */
/* ---------- 1. UNIVERSAL TEXT SCRUBBER --------------------------------- */
/* Run on EVERY parsed string before storage. After this point, no item in
 * workingItems / flagItems / metrics / compare data should contain markdown
 * symbols. Render functions can call splitTextToSize directly.              */
function scrub(text) {
  let s = String(text || "");
  // Remove bold/italic markers
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  // Strip stray asterisks/underscores left over
  s = s.replace(/\*+/g, "");
  // Strip leading list markers / hashes
  s = s.replace(/^\s*#{1,6}\s+/, "");
  s = s.replace(/^\s*[-*+\u2022]\s+/u, "");
  s = s.replace(/^\s*\d+[.)]\s+/, "");
  // Normalize unicode
  s = s.replace(/[\u2013\u2014\u2012]/g, "-");
  s = s.replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/[\u201c\u201d]/g, '"');
  s = s.replace(/\u2026/g, "...");
  s = s.replace(/\u00a0/g, " ");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
/* ---------- 2. COMPARE BLOCK (JSON) PARSING ---------------------------- */
const PROP_COMPARE_RE_FULL =
  /\[\[PROPAI_COMPARE\]\]\s*([\s\S]*?)\s*\[\[\/PROPAI_COMPARE\]\]/i;
const PROP_COMPARE_RE_SINGLE =
  /\[PROPAI_COMPARE\]\s*([\s\S]*?)\[\/PROPAI_COMPARE\]/i;
function stripPropaiCompareBlock(text) {
  let s = String(text || "");
  s = s.replace(PROP_COMPARE_RE_FULL, "");
  s = s.replace(PROP_COMPARE_RE_SINGLE, "");
  const startM = s.match(/\[\[?\s*PROPAI_COMPARE\s*\]?\]/i);
  if (startM) {
    const tail = s.slice(startM.index + startM[0].length);
    const endM = tail.match(/\[\[?\s*\/\s*PROPAI_COMPARE\s*\]?\]/i);
    if (endM) {
      s = s.slice(0, startM.index) + tail.slice(endM.index + endM[0].length);
    }
  }
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
function normalizeComparePayload(data) {
  if (!data || typeof data !== "object") return data;
  const o = { ...data };
  if (!o.suburb1 && o.suburbA) o.suburb1 = o.suburbA;
  if (!o.suburb2 && o.suburbB) o.suburb2 = o.suburbB;
  if (!o.suburb1 && o.Suburb1) o.suburb1 = o.Suburb1;
  if (!o.suburb2 && o.Suburb2) o.suburb2 = o.Suburb2;
  return o;
}
function parsePropaiCompareBlock(text) {
  const raw = String(text || "");
  const m = raw.match(PROP_COMPARE_RE_FULL) || raw.match(PROP_COMPARE_RE_SINGLE);
  if (!m) return null;
  const inner = String(m[1] || "").trim();
  try {
    return { data: normalizeComparePayload(JSON.parse(inner)), raw: inner };
  } catch {
    return null;
  }
}
/* ---------- 3. THINKING-PREAMBLE STRIPPER ------------------------------ */
function isPdfThinkingPreambleLine(trimmed) {
  const t = trimmed.trim();
  if (!t) return false;
  return (
    /^let me\b/i.test(t) ||
    /^i need to\b/i.test(t) ||
    /^i'll\b/i.test(t) ||
    /^i'm going to\b/i.test(t) ||
    /^based on my search\b/i.test(t) ||
    /^searching for\b/i.test(t)
  );
}
function stripPdfThinkingPreamble(text) {
  const lines = String(text || "").split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "" || isPdfThinkingPreambleLine(t)) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n");
}
/* ---------- 4. PROPAI MARKER PARSERS (score / verdict / walkaway) ------ */
function parsePropaiScore(text) {
  if (!text) return null;
  const m = text.match(/\[\[PROPAI_SCORE\]\]\s*(\d{1,3})\s*\/\s*100/i);
  if (m) return parseInt(m[1], 10);
  return null;
}
function parsePropaiVerdict(text) {
  if (!text) return null;
  let m = text.match(/\[\[PROPAI_VERDICT\]\]\s*(BUY|HOLD|SKIP)/i);
  if (m) return m[1].toUpperCase();
  const finalCall = text.match(/##\s*FINAL CALL\s*([\s\S]*?)(?=##\s|\[\[|$)/i);
  if (finalCall) {
    const v = finalCall[1].match(/\b(BUY|HOLD|SKIP)\b/i);
    if (v) return v[1].toUpperCase();
  }
  return null;
}
function parsePropaiWalkaway(text) {
  if (!text) return null;
  const m = text.match(/\[\[PROPAI_WALKAWAY\]\]\s*(\$[\d.,]+K?\s*-\s*\$[\d.,]+K?)/i);
  if (m) return m[1].trim();
  const fallback = text.match(/\$[\d.,]+K?\s*[-\u2013\u2014]\s*\$[\d.,]+K?/i);
  return fallback ? fallback[0].trim() : null;
}
/* ---------- 5. SECTION FINDER (forgiving) ------------------------------ */
/* Finds a section by heading keywords. Tolerant of:
 *   ## HEADING        # HEADING        ### HEADING
 *   **HEADING**       HEADING:         HEADING (on own line)
 * Returns the body of the section up to the next heading or PROPAI marker.   */
function findSection(text, keywords) {
  const raw = String(text || "");
  const kwAlt = keywords.map((k) => k.replace(/\s+/g, "\\s+")).join("|");
  const headingRe = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*\\s*)?(?:${kwAlt})(?:\\s*\\*\\*)?\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s+|\\*\\*[A-Z][^*]{2,40}\\*\\*\\s*\\n)|\\[\\[PROPAI|$)`,
    "i"
  );
  const m = raw.match(headingRe);
  return m ? m[1].trim() : "";
}
/* ---------- 6. METRICS PARSER (forgiving) ------------------------------ */
/* Accepts:
 *  - Markdown table:        | Metric | Value | Grade |
 *  - Pipe-separated lines:  Median Price | $580K | A
 *  - Bullet labelled lines: - Median Price: $580K (Strong)
 *  - "Label: Value" lines under the section
 * Returns up to 6 normalized metrics.                                      */
function parsePropaiMetrics(text) {
  const section = findSection(text, [
    "METRICS SNAPSHOT",
    "KEY METRICS SNAPSHOT",
    "KEY METRICS",
    "METRICS"
  ]);
  if (!section) return [];
  const rows = [];
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip table separator and header rows
    if (/^\|?\s*-+\s*\|/.test(line)) continue;
    if (/\|\s*Metric\s*\|/i.test(line)) continue;
    // Pipe-separated row (table or bare)
    if (line.includes("|")) {
      const cells = line.split("|").map((c) => scrub(c)).filter(Boolean);
      if (cells.length >= 2) {
        rows.push({
          metric: cells[0],
          value: cells[1] || "",
          grade: cells[2] || ""
        });
        continue;
      }
    }
    // "Label: Value (Grade)" form, with optional bullet/bold prefix
    const cleaned = scrub(line);
    const labelMatch = cleaned.match(/^([A-Za-z][A-Za-z\s/&%()-]{2,40}?)\s*[:\-\u2013\u2014]\s*(.+)$/);
    if (labelMatch) {
      const label = labelMatch[1].trim();
      const rest = labelMatch[2].trim();
      // Try to split value vs grade by "(grade)" suffix
      const gMatch = rest.match(/^(.+?)\s*[\(\[](Strong|Weak|Average|Good|Poor|Excellent|A|B|C|D|F|HIGH|MED|MEDIUM|LOW)[\)\]]/i);
      if (gMatch) {
        rows.push({ metric: label, value: gMatch[1].trim(), grade: gMatch[2] });
      } else {
        rows.push({ metric: label, value: rest, grade: "" });
      }
    }
  }
  return rows;
}
/* ---------- 7. BULL CASE PARSER (forgiving) ---------------------------- */
/* Accepts:
 *  - 1. Reason text                       (numbered)
 *  - - Reason text                        (bulleted)
 *  - **Bold title**: body text            (bold-prefixed)
 *  - Title: body text                     (label-prefixed)
 *  - Plain prose paragraph                (last resort)
 * All items are scrub()-ed before storage.                                 */
function parsePropaiBullCase(text) {
  const section = findSection(text, [
    "BULL CASE",
    "WHAT'S WORKING",
    "WHATS WORKING",
    "WHAT IS WORKING"
  ]);
  if (!section) return [];
  const items = [];
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip pure headings or dividers
    if (/^[-=_]{3,}$/.test(line)) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    // Strip bold wrapping anywhere on the line first
    let normalized = line.replace(/\*\*\s*([^*]+?)\s*\*\*/g, "$1");
    // Numbered: "1. ..." or "1) ..."
    const numbered = normalized.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      const cleaned = scrub(numbered[1]);
      if (cleaned) items.push(cleaned);
      continue;
    }
    // Bulleted: "- ..." or "* ..." or "• ..."
    const bulleted = normalized.match(/^[-*\u2022]\s+(.+)$/u);
    if (bulleted) {
      const cleaned = scrub(bulleted[1]);
      if (cleaned) items.push(cleaned);
      continue;
    }
    // Title: body  (with or without bold)
    const labelled = normalized.match(/^([A-Za-z][A-Za-z0-9\s%()&/-]{2,80})\s*[:\-\u2013\u2014]\s*(.+)$/);
    if (labelled) {
      const title = scrub(labelled[1]);
      const body = scrub(labelled[2]);
      if (title && body) items.push(`${title}: ${body}`);
      else if (body) items.push(body);
      continue;
    }
    // Plain sentence (last resort - must look like a real sentence)
    const cleaned = scrub(normalized);
    if (cleaned.length > 20 && /[a-z]/.test(cleaned)) {
      items.push(cleaned);
    }
  }
  return items.filter(Boolean);
}
/* ---------- 8. BEAR CASE PARSER (forgiving) ---------------------------- */
/* Accepts the same shapes as bull case. Returns array of {title, body}.
 * Excludes generic mortgage/cashflow noise.                                */
function parsePropaiBearCase(text) {
  const section = findSection(text, [
    "BEAR CASE",
    "RED FLAGS",
    "RISKS",
    "WHAT COULD GO WRONG"
  ]);
  if (!section) return [];
  const items = [];
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^[-=_]{3,}$/.test(line)) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    let normalized = line.replace(/\*\*\s*([^*]+?)\s*\*\*/g, "$1");
    // Strip leading list/number markers
    normalized = normalized.replace(/^\d+[.)]\s+/, "");
    normalized = normalized.replace(/^[-*\u2022]\s+/u, "");
    // Title: body (with optional inner colon - "Risk: Single thing - actual desc")
    const labelled = normalized.match(/^([A-Za-z][A-Za-z0-9\s%()&/-]{2,80})\s*[:\-\u2013\u2014]\s*(.+)$/);
    if (labelled) {
      let title = scrub(labelled[1]);
      let body = scrub(labelled[2]);
      // Unwrap nested generic prefix (e.g. "Risk: Employer Dependency: actual desc")
      if (/^(single|risk|issue|concern|red flag)$/i.test(title)) {
        const nested = body.match(/^([^:]{2,80})\s*[:\-\u2013\u2014]\s*(.+)$/);
        if (nested) {
          title = scrub(nested[1]);
          body = scrub(nested[2]);
        }
      }
      if (title && body) items.push({ title, body });
      continue;
    }
    // Plain sentence as a "Risk"
    const cleaned = scrub(normalized);
    if (cleaned.length > 20 && /[a-z]/.test(cleaned)) {
      items.push({ title: "Risk", body: cleaned });
    }
  }
  // Filter mortgage/cashflow noise (those belong on exec summary)
  return items.filter((item) => {
    const combined = `${item.title} ${item.body}`.toLowerCase();
    return !/(principal|interest|rates|insurance|strata|mortgage|repayments|rent\s*\$|cashflow)/i.test(combined);
  });
}
/* ---------- 9. NAMED SECTION EXTRACTOR (executive summary, cashflow) --- */
function extractSection(text, tag) {
  if (!text) return "";
  const re = new RegExp(`\\[\\[${tag}_START\\]\\]([\\s\\S]*?)\\[\\[${tag}_END\\]\\]`);
  const m = text.match(re);
  return m ? m[1].trim() : "";
}
/* ---------- 10. SUBURB NAME EXTRACTOR ---------------------------------- */
function cleanSuburbCandidate(s) {
  return scrub(s).replace(/\s+/g, " ").trim().slice(0, 92);
}
function extractReportTitle(analysisText) {
  const raw = String(analysisText || "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 45);
  for (const line of head) {
    const house = line.match(/\u{1F3E1}\s*(.+)/u);
    if (house) {
      const t = cleanSuburbCandidate(house[1]);
      if (t) return t;
    }
  }
  for (const line of head) {
    const plain = scrub(line);
    const m = plain.match(/^(.+?),\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b\.?$/i);
    if (m && m[1].length >= 2 && m[1].length < 85) {
      const t = cleanSuburbCandidate(`${m[1].trim()}, ${m[2].toUpperCase()}`);
      if (t) return t;
    }
  }
  const blob = raw.slice(0, 3500);
  const anywhere = blob.match(
    /\b([A-Za-z][A-Za-z]+(?:\s+[A-Za-z]+){0,2}),\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/
  );
  if (anywhere) {
    const t = cleanSuburbCandidate(`${anywhere[1].trim()}, ${anywhere[2].toUpperCase()}`);
    if (t) return t;
  }
  return "Property investment report";
}
function extractSuburbName(analysisText, userPrompt) {
  const headingMatch = analysisText?.match(
    /##?\s*([A-Za-z][A-Za-z\s]+?),?\s*(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\s*\d{4}/
  );
  if (headingMatch) {
    const n = headingMatch[1].trim();
    if (!/^report$/i.test(n)) return n;
  }
  const cleanedPrompt = String(userPrompt || "")
    .replace(/\b(analysis|report|intelligence|review|suburb|score|property)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const promptMatch = cleanedPrompt.match(
    /\b([A-Za-z][A-Za-z\s'-]{1,40})\s+(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\b/i
  );
  if (promptMatch) {
    const candidate = promptMatch[1].trim();
    if (candidate && !/^report$/i.test(candidate)) {
      return candidate
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
  }
  return "Property";
}
/* ---------- 11. COMPARE EXTRACTION (broad scan) ------------------------ */
function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/* For each occurrence of `suburb` in `text`, return a local context window
 * that does NOT cross any mention of `excludeSuburb`. The window extends
 * from the previous excludeSuburb (or m.index - 30) to the next excludeSuburb
 * (or m.index + len + radius). Concatenated to a single search blob.       */
function getSuburbScopedContext(text, suburb, excludeSuburb, radius = 120) {
  const raw = String(text || "");
  if (!suburb) return "";
  const subRe = new RegExp(escRe(suburb), "gi");
  const chunks = [];
  // Pre-collect all positions of excludeSuburb
  const excludePositions = [];
  if (excludeSuburb) {
    const exRe = new RegExp(escRe(excludeSuburb), "gi");
    let xm;
    while ((xm = exRe.exec(raw)) !== null) {
      excludePositions.push({ start: xm.index, end: xm.index + xm[0].length });
      if (exRe.lastIndex === xm.index) exRe.lastIndex++;
    }
  }
  let m;
  while ((m = subRe.exec(raw)) !== null) {
    const matchEnd = m.index + m[0].length;
    // When excluding another suburb, only look FORWARD from this suburb's name.
    // Looking backward risks including text that semantically belongs to the
    // previous (excluded) suburb's clause.
    let start = excludeSuburb ? m.index : Math.max(0, m.index - 30);
    let end = Math.min(raw.length, matchEnd + radius);
    // Shrink end: don't cross the next excludeSuburb after matchEnd
    for (const xp of excludePositions) {
      if (xp.start >= matchEnd && xp.start < end) {
        end = xp.start;
        break; // positions are in order
      }
    }
    chunks.push(raw.slice(start, end));
    if (subRe.lastIndex === m.index) subRe.lastIndex++;
  }
  return chunks.join(" \n ");
}
/* Find a value (e.g. "4.96%") in suburb-scoped context. Only returns a
 * value if a label keyword is present near it - otherwise we'd pick up a
 * neighbouring metric's value.                                             */
function findMetricInContext(context, labelKeywords, valuePattern) {
  if (!context) return "";
  const labelRe = labelKeywords.map(escRe).join("|");
  // Pattern 1: LABEL ... VALUE (label-first - most reliable in prose)
  const reA = new RegExp(`(?:${labelRe})[^\\n]{0,60}?(${valuePattern})`, "i");
  const a = context.match(reA);
  if (a) return a[1].trim();
  // Pattern 2: VALUE ... LABEL (value-first - "5.25% yield")
  const reB = new RegExp(`(${valuePattern})[^\\n]{0,30}?(?:${labelRe})`, "i");
  const b = context.match(reB);
  if (b) return b[1].trim();
  // No bare-value fallback: too easy to grab a neighbouring metric's number.
  return "";
}
function findSuburbScore(text, suburb, excludeSuburb) {
  const ctx = getSuburbScopedContext(text, suburb, excludeSuburb, 150);
  // Score is usually "X/100" - prefer that form
  const slash = ctx.match(/(\d{1,3})\s*\/\s*100/);
  if (slash) return slash[1];
  // Or "Score: X" / "Deal Score X"
  const labelled = ctx.match(/score[^\d]{0,20}(\d{1,3})\b/i);
  if (labelled) return labelled[1];
  return "";
}
function findSuburbYield(text, suburb, excludeSuburb) {
  const ctx = getSuburbScopedContext(text, suburb, excludeSuburb, 120);
  return findMetricInContext(ctx, ["yield", "rental yield", "gross yield"], "\\d+(?:\\.\\d+)?%");
}
function findSuburbGrowth(text, suburb, excludeSuburb) {
  const ctx = getSuburbScopedContext(text, suburb, excludeSuburb, 120);
  const labeled = findMetricInContext(ctx, ["growth", "capital growth", "12m growth", "annual growth"], "[+\\-]?\\d+(?:\\.\\d+)?%");
  if (labeled) return labeled;
  /* Fallback for growth: LLM often writes "Aitkenvale (22.1%)" without
   * a "growth" keyword nearby. The parenthetical % directly after the
   * suburb name is conventional shorthand for capital growth.            */
  const raw = String(text || "");
  const subRe = new RegExp(`${escRe(suburb)}\\s*\\(([+\\-]?\\d+(?:\\.\\d+)?%)\\)`, "i");
  const m = raw.match(subRe);
  if (m) return m[1].trim();
  return "";
}
function findSuburbVerdict(text, suburb, excludeSuburb) {
  const ctx = getSuburbScopedContext(text, suburb, excludeSuburb, 150);
  const m = ctx.match(/\b(BUY|HOLD|SKIP|NEGOTIATE|AVOID|WATCH|WAIT|PASS)\b/i);
  if (!m) return "";
  const v = m[1].toUpperCase();
  if (v === "WATCH" || v === "WAIT" || v === "NEGOTIATE") return "HOLD";
  if (v === "AVOID" || v === "PASS") return "SKIP";
  return v;
}
function buildCompareDataFromText(text, suburbA, suburbB) {
  if (!suburbA || !suburbB) return null;
  return {
    suburb1: {
      name: suburbA,
      score: findSuburbScore(text, suburbA, suburbB),
      yield: findSuburbYield(text, suburbA, suburbB),
      growth: findSuburbGrowth(text, suburbA, suburbB),
      verdict: findSuburbVerdict(text, suburbA, suburbB)
    },
    suburb2: {
      name: suburbB,
      score: findSuburbScore(text, suburbB, suburbA),
      yield: findSuburbYield(text, suburbB, suburbA),
      growth: findSuburbGrowth(text, suburbB, suburbA),
      verdict: findSuburbVerdict(text, suburbB, suburbA)
    },
    winner: { name: "", reason: "" }
  };
}
function normalizeCompareWinner(data) {
  const win = data?.winner || {};
  return {
    name: String(win.name || "").trim(),
    reason: String(win.reason || "").trim()
  };
}
function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return v;
  }
  return "";
}
/* =========================================================================
 *  MAIN PDF BUILDER
 * ======================================================================= */
export function buildBrandedPdf(analysisText, options = {}) {
  const compareMeta = options.compareMeta;
  const cashflowBody = extractSection(analysisText, "CASHFLOW");
  const src = stripPdfThinkingPreamble(stripPropaiCompareBlock(analysisText));
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const PW = 210;
  const PH = 297;
  const MX = 20;
  /* ---------- COLORS ---------- */
  const CREAM = [245, 239, 227];
  const PAPER = [251, 248, 241];
  const INK = [26, 31, 26];
  const INK_SOFT = [74, 82, 74];
  const INK_MUTED = [138, 143, 135];
  const FOREST = [45, 74, 43];
  const FOREST_DEEP = [30, 50, 25];
  const ORANGE = [217, 107, 44];
  const AMBER = [200, 145, 43];
  const CRIMSON = [180, 66, 56];
  const LINE = [217, 209, 191];
  const LINE_SOFT = [232, 224, 205];
  /* ---------- RENDER-TIME CLEANER ---------- */
  /* Belt-and-braces: even though parsers scrub already, drop any non-ASCII
   * that jsPDF can't render with default fonts.                            */
  const clean = (t) =>
    String(t || "")
      .replace(/[\u2013\u2014\u2012]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\u2026/g, "...")
      .replace(/\u00a0/g, " ")
      .replace(/\*\*/g, "")
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
      .replace(/[\u{2600}-\u{27BF}]/gu, "")
      .replace(/[^\x00-\x7F]/g, "")
      .trim();
  /* ---------- DRAW HELPERS ---------- */
  const setFill = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const setStroke = (c) => doc.setDrawColor(c[0], c[1], c[2]);
  const setText = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const paintBg = (c) => {
    setFill(c);
    doc.rect(0, 0, PW, PH, "F");
  };
  const drawPageHead = (sectionLabel) => {
    setFill(ORANGE);
    doc.circle(MX + 1.6, 20, 1.6, "F");
    setText(FOREST_DEEP);
    doc.setFont("times", "normal");
    doc.setFontSize(13);
    doc.text("PropAI", MX + 5, 22);
    setText(INK_MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(clean(sectionLabel).toUpperCase(), PW - MX, 22, { align: "right", charSpace: 0.8 });
    setStroke(LINE);
    doc.setLineWidth(0.2);
    doc.line(MX, 26, PW - MX, 26);
  };
  const drawPageFoot = (pageRoman) => {
    setStroke(LINE);
    doc.setLineWidth(0.2);
    doc.line(MX, PH - 18, PW - MX, PH - 18);
    setText(INK_MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("PROPAI - AUSTRALIAN PROPERTY INTELLIGENCE", MX, PH - 12, { charSpace: 0.4 });
    doc.setFont("times", "italic");
    doc.setFontSize(9);
    doc.text(String(pageRoman), PW - MX, PH - 12, { align: "right" });
  };
  const drawEyebrow = (text, x, y) => {
    setText(FOREST);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(clean(text).toUpperCase(), x, y, { charSpace: 0.8 });
  };
  const drawTitleTwoTone = (plain, italic, x, y, size = 26) => {
    let w = 0;
    if (plain) {
      setText(INK);
      doc.setFont("times", "normal");
      doc.setFontSize(size);
      doc.text(plain, x, y);
      w = doc.getTextWidth(plain);
    }
    if (italic) {
      setText(FOREST);
      doc.setFont("times", "italic");
      doc.setFontSize(size);
      doc.text(italic, plain ? x + w + 1 : x, y);
    }
  };
  /* ---------- SUBURB & STATE ---------- */
  const normalizeSuburbLabel = (value) =>
    String(value || "")
      .replace(/,\s*(QLD|NSW|VIC|WA|SA|TAS|NT|ACT)(?:\s+\d{4})?$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  const isInvalidSuburbLabel = (value) => {
    const s = normalizeSuburbLabel(value).toLowerCase();
    return !s || s === "report" || s === "property" || s === "property investment report" || /\breport\b/.test(s);
  };
  let suburbName = normalizeSuburbLabel(extractSuburbName(analysisText, options.userPrompt || ""));
  const titleDerivedSuburb = normalizeSuburbLabel(extractReportTitle(analysisText));
  if (isInvalidSuburbLabel(suburbName) && !isInvalidSuburbLabel(titleDerivedSuburb)) {
    suburbName = titleDerivedSuburb;
  }
  let stateCode = (src.match(/\b(QLD|NSW|VIC|WA|SA|TAS|NT|ACT)\b/)?.[1]) || "QLD";
  const postcode = (src.match(/\b(\d{4})\b/)?.[1]) || "";
  if (compareMeta) {
    suburbName = `${compareMeta.suburb1} vs ${compareMeta.suburb2}`;
    stateCode = compareMeta.state;
  }
  /* ---------- SCORE / VERDICT / WALK-AWAY ---------- */
  const parsedScore = parsePropaiScore(analysisText);
  const score = parsedScore != null ? parsedScore : null;
  const scoreLabel = parsedScore != null ? String(parsedScore) : "--";
  const scoreMax = "100";
  const scorePct = parsedScore != null ? Math.min(1, parsedScore / 100) : 0;
  const parsedVerdict = parsePropaiVerdict(analysisText);
  const verdict = (() => {
    if (parsedScore != null) {
      if (parsedScore >= 70) return "BUY";
      if (parsedScore >= 50) return "HOLD";
      return "SKIP";
    }
    if (parsedVerdict === "BUY" || parsedVerdict === "HOLD" || parsedVerdict === "SKIP") return parsedVerdict;
    return "HOLD";
  })();
  const walkAway = parsePropaiWalkaway(analysisText) || "Data unavailable";
  const verdictColor =
    verdict === "BUY" ? FOREST :
    verdict === "SKIP" ? CRIMSON :
    verdict === "HOLD" ? AMBER :
    INK_MUTED;
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const refBase = compareMeta ? String(compareMeta.suburb1 || "SUB") : suburbName;
  const refPrefix = refBase.replace(/\s.*/, "").slice(0, 3).toUpperCase() || "RPT";
  /* ---------- METRICS ---------- */
  const requiredMetricNames = [
    "Median Price",
    "Rental Yield",
    "Capital Growth",
    "Vacancy Rate",
    "Days on Market",
    "Stock on Market"
  ];
  const parsedMetrics = parsePropaiMetrics(analysisText);
  const metrics = parsedMetrics.slice(0, 6).map((row) => ({
    label: clean(row.metric || "Data unavailable") || "Data unavailable",
    value: clean(row.value || "Data unavailable") || "Data unavailable",
    grade: clean(row.grade || "") || ""
  }));
  while (metrics.length < 6) {
    const label = requiredMetricNames[metrics.length] || "Data unavailable";
    metrics.push({ label, value: "Data unavailable", grade: "" });
  }
  /* ---------- BULL & BEAR ---------- */
  const workingItemsRaw = parsePropaiBullCase(analysisText);
  const workingItems = workingItemsRaw.length
    ? workingItemsRaw
    : ["Bull case content unavailable - please regenerate analysis to populate this section."];
  let flagItemsRaw = parsePropaiBearCase(analysisText);
  if (!flagItemsRaw.length) {
    flagItemsRaw = [{ title: "Risk", body: "Bear case content unavailable - please regenerate analysis to populate this section." }];
  }
  const flagItems = flagItemsRaw;
  const compareBlockParsed = parsePropaiCompareBlock(analysisText);
  /* ---------- FINAL CALL TEXT ---------- */
  const finalCallSection = src.match(/##\s*FINAL CALL\s*([\s\S]*?)(?=##\s|\[\[PROPAI|$)/i);
  const finalCallLineFallback = src.match(/(?:^|\n)\s*(BUY|HOLD|SKIP)\b[^\n]{12,220}/i);
  const finalCallText = (() => {
    if (finalCallSection?.[1]) {
      const firstLine = finalCallSection[1].split("\n").map((l) => clean(scrub(l))).find(Boolean);
      if (firstLine) return firstLine;
    }
    if (finalCallLineFallback) return clean(scrub(finalCallLineFallback[0]));
    return `${verdict} - data-backed recommendation based on parsed metrics and risk profile.`;
  })();
  /* ---------- COMPARE DATA ASSEMBLY ---------- */
  const compareNameA = clean(String(compareMeta?.suburb1 || suburbName.split(/\s+vs\s+/i)[0] || "Suburb A"));
  const compareNameB = clean(String(compareMeta?.suburb2 || suburbName.split(/\s+vs\s+/i)[1] || "Suburb B"));
  /* Strip global single-line markers and the report title before compare
   * extraction - otherwise the title's mention of a suburb name pulls in
   * the global PROPAI_SCORE/VERDICT/WALKAWAY which are for the primary.   */
  const compareSrcText = (() => {
    let s = String(analysisText || "");
    s = s.replace(/\[\[PROPAI_SCORE\]\]\s*\d{1,3}\s*\/\s*100/gi, "");
    s = s.replace(/\[\[PROPAI_VERDICT\]\]\s*(?:BUY|HOLD|SKIP)/gi, "");
    s = s.replace(/\[\[PROPAI_WALKAWAY\]\]\s*\$[^\n]+/gi, "");
    // Drop the title/heading line if it contains "vs"
    s = s.replace(/^[^\n]*\bvs\b[^\n]*\n/i, "");
    return s;
  })();
  const compareFromText = compareMeta
    ? buildCompareDataFromText(compareSrcText, compareNameA, compareNameB)
    : null;
  const jsonCompareData =
    compareBlockParsed?.data?.suburb1 && compareBlockParsed?.data?.suburb2
      ? compareBlockParsed.data
      : null;
  /* Global fallback: ONLY for the primary suburb (suburb1).
   * The metric snapshot represents the primary suburb's data, so using it
   * for suburb2 would attribute the wrong numbers.                         */
  const metricByLabel = Object.fromEntries(
    metrics.map((m) => [String(m.label || "").toLowerCase(), m.value])
  );
  const globalYield = String(metricByLabel["rental yield"] || "").trim();
  const globalGrowth = String(metricByLabel["capital growth"] || "").trim();
  const parsePercentish = (v) => {
    const s = String(v || "").trim();
    const m = s.match(/[+\-]?\d+(?:\.\d+)?%/);
    return m ? m[0] : s;
  };
  const pickSuburbPrimary = (json, fromText, nameFallback) => ({
    name: firstNonEmpty(json?.name, fromText?.name, nameFallback) || nameFallback,
    score: firstNonEmpty(json?.score, fromText?.score, parsedScore != null ? `${parsedScore}` : ""),
    yield: firstNonEmpty(json?.yield, fromText?.yield, parsePercentish(globalYield)),
    growth: firstNonEmpty(json?.growth, fromText?.growth, parsePercentish(globalGrowth)),
    verdict: firstNonEmpty(json?.verdict, fromText?.verdict, verdict)
  });
  const pickSuburbSecondary = (json, fromText, nameFallback) => ({
    name: firstNonEmpty(json?.name, fromText?.name, nameFallback) || nameFallback,
    score: firstNonEmpty(json?.score, fromText?.score, ""),
    yield: firstNonEmpty(json?.yield, fromText?.yield, ""),
    growth: firstNonEmpty(json?.growth, fromText?.growth, ""),
    verdict: firstNonEmpty(json?.verdict, fromText?.verdict, "")
  });
  const effectiveCompareData = compareMeta
    ? {
        suburb1: pickSuburbPrimary(jsonCompareData?.suburb1, compareFromText?.suburb1, compareNameA),
        suburb2: pickSuburbSecondary(jsonCompareData?.suburb2, compareFromText?.suburb2, compareNameB),
        winner: jsonCompareData?.winner || { name: "", reason: "" }
      }
    : null;
  const formatCompareScore = (v) => {
    if (v == null || v === "") return "Data unavailable";
    if (typeof v === "number") return `${v}/100`;
    const s = String(v).trim();
    const embedded = s.match(/(\d{1,3})\s*\/\s*100/i);
    if (embedded) return `${embedded[1]}/100`;
    if (/^\d{1,3}$/.test(s)) return `${s}/100`;
    return s;
  };
  /* ---------- THESIS / SUBTITLE ---------- */
  const thesisMatch = src.match(/(?:^|\n\n)([A-Z][^\n]{40,200}[.!])/);
  const thesis = thesisMatch ? clean(scrub(thesisMatch[1])) : `A rentvestor-grade analysis of ${suburbName}.`;
  const coverSubtitle = compareMeta
    ? `A rentvestor's analysis of ${compareMeta.suburb1} vs ${compareMeta.suburb2}, prepared by PropAI. Deal Score, Walk-Away Number, and full negotiation strategy inside.`
    : `A rentvestor's analysis of ${suburbName}, prepared by PropAI. Deal Score, Walk-Away Number, and full negotiation strategy inside.`;
  /* =========================================================================
   *  PAGE 1 — COVER
   * ======================================================================= */
  const drawCover = () => {
    paintBg(CREAM);
    setFill(ORANGE);
    doc.circle(MX + 1.6, 24, 1.6, "F");
    setText(INK);
    doc.setFont("times", "normal");
    doc.setFontSize(18);
    doc.text("PropAI", MX + 5, 26);
    setText(INK_MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    const rightX = PW - MX;
    doc.text("CONFIDENTIAL REPORT", rightX, 20, { align: "right", charSpace: 0.6 });
    doc.text(today.toUpperCase(), rightX, 24, { align: "right", charSpace: 0.6 });
    doc.text(`REF - ${refPrefix}-${postcode || "0000"}-001`, rightX, 28, { align: "right", charSpace: 0.6 });
    drawEyebrow("SUBURB INTELLIGENCE REPORT", MX, 102);
    const titleStr = compareMeta
      ? `${compareMeta.suburb1} vs ${compareMeta.suburb2},`
      : `${suburbName},`;
    const titleAvailW = PW - 2 * MX;
    let fittedSize = 72;
    doc.setFont("times", "normal");
    doc.setFontSize(fittedSize);
    while (doc.getTextWidth(titleStr) > titleAvailW && fittedSize > 36) {
      fittedSize -= 2;
      doc.setFontSize(fittedSize);
    }
    setText(INK);
    doc.text(titleStr, MX, 138);
    const stateY = fittedSize >= 54 ? 170 : 138 + fittedSize * 0.55;
    setText(FOREST);
    doc.setFont("times", "italic");
    doc.setFontSize(fittedSize);
    doc.text(`${stateCode}.`, MX, stateY);
    setText(INK_SOFT);
    doc.setFont("times", "italic");
    doc.setFontSize(16);
    const subtitleLines = doc.splitTextToSize(clean(coverSubtitle), PW - 2 * MX - 40);
    doc.text(subtitleLines, MX, 188);
    setStroke(LINE);
    doc.setLineWidth(0.2);
    doc.line(MX, 204, PW - MX - 60, 204);
    setText(INK_MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("DEAL SCORE", MX, PH - 36);
    doc.text("WALK-AWAY", PW - MX, PH - 36, { align: "right" });
    setText(INK);
    doc.setFont("times", "normal");
    doc.setFontSize(16);
    doc.text(score != null ? `${scoreLabel} / ${scoreMax}` : scoreLabel, MX, PH - 28);
    doc.text(clean(walkAway), PW - MX, PH - 28, { align: "right" });
    const pillW = 60;
    const pillH = 11;
    const pillX = PW / 2 - pillW / 2;
    const pillY = PH - 42;
    setFill(verdictColor);
    doc.roundedRect(pillX, pillY, pillW, pillH, 5.5, 5.5, "F");
    setFill(CREAM);
    doc.circle(pillX + 6, pillY + 5.5, 1.2, "F");
    setText(CREAM);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`VERDICT - ${verdict}`, pillX + 12, pillY + 7.5, { charSpace: 1 });
  };
  /* =========================================================================
   *  PAGE 2 — EXECUTIVE SUMMARY
   * ======================================================================= */
  const drawExecSummary = () => {
    paintBg(PAPER);
    drawPageHead(`${suburbName} ${stateCode}`);
    drawEyebrow("EXECUTIVE SUMMARY", MX, 42);
    drawTitleTwoTone("The ", "thesis,", MX, 60, 28);
    drawTitleTwoTone("in one ", "page.", MX, 72, 28);
    setText(INK_SOFT);
    doc.setFont("times", "italic");
    doc.setFontSize(13);
    const execBlock = findSection(src, ["EXECUTIVE SUMMARY", "SUMMARY", "THESIS"]);
    const fullThesis = clean(scrub(execBlock || thesis));
    const thLines = doc.splitTextToSize(fullThesis, PW - 2 * MX - 20);
    doc.text(thLines, MX, 88);
    const gridTop = 106;
    const gridH = 44;
    const gridW = PW - 2 * MX;
    const cellW = gridW / 2;
    setFill(CREAM);
    setStroke(LINE);
    doc.setLineWidth(0.2);
    doc.rect(MX, gridTop, gridW, gridH, "FD");
    doc.line(MX + cellW, gridTop, MX + cellW, gridTop + gridH);
    setText(INK_MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("DEAL SCORE", MX + 8, gridTop + 10, { charSpace: 0.8 });
    doc.text("VERDICT", MX + cellW + 8, gridTop + 10, { charSpace: 0.8 });
    setText(INK);
    doc.setFont("times", "normal");
    doc.setFontSize(30);
    doc.text(scoreLabel, MX + 8, gridTop + 26);
    setText(INK_MUTED);
    doc.setFont("times", "italic");
    doc.setFontSize(13);
    if (score != null) doc.text(` / ${scoreMax}`, MX + 8 + doc.getTextWidth(scoreLabel) + 2, gridTop + 26);
    const prettyV = verdict.charAt(0) + verdict.slice(1).toLowerCase();
    setText(verdictColor);
    doc.setFont("times", "italic");
    doc.setFontSize(24);
    doc.text(prettyV, MX + cellW + 8, gridTop + 28);
    const barW = cellW - 16;
    const barY = gridTop + 32;
    setFill(LINE_SOFT);
    doc.rect(MX + 8, barY, barW, 1.5, "F");
    setFill(FOREST);
    doc.rect(MX + 8, barY, barW * scorePct, 1.5, "F");
    if (cashflowBody) {
      setText(INK_SOFT);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const cfLines = doc.splitTextToSize(clean(scrub(cashflowBody)), PW - 2 * MX);
      let ly = 184;
      for (let ci = 0; ci < cfLines.length; ci++) {
        if (ly > PH - 28) break;
        doc.text(cfLines[ci], MX, ly);
        ly += 4.6;
      }
    }
    drawPageFoot("ii");
  };
  /* =========================================================================
   *  PAGE 3 — METRICS
   * ======================================================================= */
  const drawMetrics = () => {
    paintBg(PAPER);
    drawPageHead("KEY METRICS");
    drawEyebrow("METRICS SNAPSHOT", MX, 42);
    drawTitleTwoTone("Six numbers", "", MX, 60, 28);
    drawTitleTwoTone("that tell the ", "story.", MX, 72, 28);
    const cardW = (PW - 2 * MX - 6) / 2;
    const cardH = 32;
    const gap = 6;
    const startY = 86;
    metrics.slice(0, 6).forEach((metric, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = MX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);
      const isFeature = i === 3 || i === 5;
      if (isFeature) {
        setFill(FOREST);
        doc.rect(x, y, cardW, cardH, "F");
        setText([200, 195, 180]);
      } else {
        setFill(CREAM);
        setStroke(LINE);
        doc.setLineWidth(0.2);
        doc.rect(x, y, cardW, cardH, "FD");
        setText(INK_MUTED);
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.text(clean(metric.label).toUpperCase().slice(0, 32), x + 5, y + 7, { charSpace: 0.6 });
      setText(isFeature ? CREAM : INK);
      doc.setFont("times", "normal");
      const valueStr = clean(metric.value || "Data unavailable").trim() || "Data unavailable";
      // Split value into main + sub: "$580K (median)" -> main "$580K", sub "median"
      const parts = valueStr.match(/^([^\s(]+)\s*(.*)$/);
      const mainVal = parts ? parts[1] : valueStr;
      const subVal = parts ? parts[2].replace(/^\((.*)\)$/, "$1").trim() : "";
      doc.setFontSize(mainVal.length > 12 ? 14 : mainVal.length > 8 ? 17 : 20);
      doc.text(mainVal.slice(0, 18), x + 5, y + 20);
      if (subVal) {
        setText(isFeature ? [220, 215, 200] : INK_MUTED);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        const sub = doc.splitTextToSize(subVal, cardW - 10);
        doc.text(sub.slice(0, 1), x + 5, y + 27);
      }
    });
    drawPageFoot("iii");
  };
  /* =========================================================================
   *  PAGE 4 — BULL CASE
   * ======================================================================= */
  const drawWhatsWorking = () => {
    paintBg(PAPER);
    drawPageHead("WHAT'S WORKING");
    drawEyebrow("BULL CASE", MX, 42);
    drawTitleTwoTone(`Why ${suburbName}`, "", MX, 60, 28);
    drawTitleTwoTone("is ", "moving.", MX, 72, 28);
    const contentBottom = PH - 18;
    const listStart = 88;
    const items = workingItems.slice(0, 6);
    const nWork = Math.max(items.length, 1);
    const slotH = (contentBottom - listStart) / nWork;
    items.forEach((item, i) => {
      const workY = listStart + i * slotH;
      const num = String(i + 1).padStart(2, "0");
      setText(FOREST);
      doc.setFont("times", "italic");
      doc.setFontSize(22);
      doc.text(num, MX, workY);
      // Try to split "Title: body" for nicer display
      const cleaned = clean(item);
      const split = cleaned.match(/^([^:]{2,80}):\s*(.+)$/);
      const headline = split ? split[1].trim() : `Reason ${i + 1}`;
      const body = split ? split[2].trim() : cleaned;
      setText(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(headline.slice(0, 70), MX + 14, workY - 2);
      setText(INK_SOFT);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const bodyLines = doc.splitTextToSize(body, PW - 2 * MX - 14);
      let by = workY + 4;
      bodyLines.slice(0, 4).forEach((line) => {
        doc.text(line, MX + 14, by, { maxWidth: PW - 2 * MX - 14 });
        by += 4.5;
      });
    });
    drawPageFoot("iv");
  };
  /* =========================================================================
   *  PAGE 5 — BEAR CASE
   * ======================================================================= */
  const drawRedFlags = () => {
    paintBg(PAPER);
    drawPageHead("RED FLAGS");
    drawEyebrow("BEAR CASE", MX, 42);
    drawTitleTwoTone("What could", "", MX, 60, 28);
    drawTitleTwoTone("go ", "wrong.", MX, 72, 28);
    const flagContentBottom = PH - 18;
    const flagListStart = 86;
    const items = flagItems.slice(0, 6);
    const nFlags = Math.max(items.length, 1);
    const flagSlotH = (flagContentBottom - flagListStart) / nFlags;
    items.forEach((item, i) => {
      const flagY = flagListStart + i * flagSlotH;
      setFill([251, 238, 235]);
      doc.circle(MX + 4, flagY + 1, 3.5, "F");
      setText(CRIMSON);
      doc.setFont("times", "italic");
      doc.setFontSize(13);
      doc.text("!", MX + 4, flagY + 3, { align: "center" });
      const title = clean(item.title || "Risk").slice(0, 60);
      const body = clean(item.body || "");
      setText(CRIMSON);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text(title, MX + 11, flagY);
      setText(INK_SOFT);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const bLines = doc.splitTextToSize(body, PW - 2 * MX - 11);
      let fy = flagY + 6;
      bLines.slice(0, 3).forEach((line) => {
        doc.text(line, MX + 11, fy);
        fy += 4.5;
      });
    });
    drawPageFoot("v");
  };
  /* =========================================================================
   *  PAGE 6 — WALK-AWAY
   * ======================================================================= */
  const drawWalkAway = () => {
    paintBg(PAPER);
    drawPageHead("THE DECISION");
    drawEyebrow("THE VERDICT", MX, 42);
    drawTitleTwoTone("Your walk-away", "", MX, 60, 28);
    drawTitleTwoTone("", "number.", MX, 72, 28);
    const waY = 84;
    const waH = 44;
    setFill(CREAM);
    doc.rect(MX, waY, PW - 2 * MX, waH, "F");
    setStroke(FOREST);
    doc.setLineWidth(0.8);
    doc.rect(MX, waY, PW - 2 * MX, waH);
    setText(FOREST);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("MAXIMUM PURCHASE PRICE", MX + 10, 94, { charSpace: 0.9 });
    setText(FOREST_DEEP);
    doc.setFont("times", "normal");
    doc.setFontSize(32);
    doc.text(clean(walkAway), MX + 10, 108);
    setFill(FOREST);
    doc.rect(MX, 138, PW - 2 * MX, 28, "F");
    setText(PAPER);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("FINAL CALL - ACTIONABLE", MX + 10, 148, { charSpace: 0.9 });
    setText(CREAM);
    doc.setFont("times", "normal");
    doc.setFontSize(15);
    const fcLines = doc.splitTextToSize(clean(finalCallText).substring(0, 200), PW - 2 * MX - 20);
    let fy = 158;
    fcLines.slice(0, 2).forEach((l) => {
      doc.text(l, MX + 10, fy);
      fy += 6;
    });
    setText(INK_SOFT);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const waLines = doc.splitTextToSize(
      "Targets 4-4.5% gross yield, preserving a cashflow buffer on a 20% deposit at current rates.",
      PW - 2 * MX - 20
    );
    doc.text(waLines, MX + 10, 178);
    drawPageFoot("vi");
  };
  /* =========================================================================
   *  PAGE 7 — HEAD-TO-HEAD (compare mode only)
   * ======================================================================= */
  const drawCompareHeadToHead = () => {
    paintBg(PAPER);
    drawPageHead("HEAD-TO-HEAD");
    drawEyebrow("THE COMPARISON", MX, 42);
    drawTitleTwoTone("Two suburbs,", "", MX, 60, 28);
    drawTitleTwoTone("one ", "winner.", MX, 72, 28);
    const data = effectiveCompareData;
    const s1 = data?.suburb1;
    const s2 = data?.suburb2;
    const valueOrUnavailable = (v) => {
      if (v == null) return "Data unavailable";
      const s = String(v).trim();
      return s ? s : "Data unavailable";
    };
    const win = normalizeCompareWinner(data || {});
    const n1 = clean(String(s1?.name || compareMeta?.suburb1 || "Suburb A"));
    const n2 = clean(String(s2?.name || compareMeta?.suburb2 || "Suburb B"));
    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(n1, MX, 92);
    doc.text(n2, MX + (PW - 2 * MX) / 2 + 2, 92);
    const rows = [
      { label: "SCORE", a: formatCompareScore(s1?.score), b: formatCompareScore(s2?.score) },
      { label: "YIELD", a: clean(valueOrUnavailable(s1?.yield)), b: clean(valueOrUnavailable(s2?.yield)) },
      { label: "GROWTH", a: clean(valueOrUnavailable(s1?.growth)), b: clean(valueOrUnavailable(s2?.growth)) },
      { label: "VERDICT", a: clean(valueOrUnavailable(s1?.verdict)), b: clean(valueOrUnavailable(s2?.verdict)) }
    ];
    let cy = 100;
    const half = (PW - 2 * MX - 4) / 2;
    rows.forEach((r) => {
      [0, 1].forEach((side) => {
        const x = MX + side * (half + 4);
        setFill(CREAM);
        setStroke(LINE);
        doc.setLineWidth(0.2);
        doc.rect(x, cy, half, 22, "FD");
        setText(INK_MUTED);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.text(r.label, x + 4, cy + 6, { charSpace: 0.5 });
        setText(INK);
        doc.setFont("times", "normal");
        doc.setFontSize(14);
        const val = side === 0 ? r.a : r.b;
        doc.text(String(val).substring(0, 26), x + 4, cy + 16);
      });
      cy += 26;
    });
    if (win.name) {
      setFill(FOREST);
      doc.rect(MX, cy + 6, PW - 2 * MX, 18, "F");
      setText(CREAM);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("WINNER", MX + 6, cy + 13, { charSpace: 0.8 });
      doc.setFont("times", "normal");
      doc.setFontSize(13);
      doc.text(clean(win.name), MX + 6, cy + 20);
    }
    drawPageFoot("vii");
  };
  /* ---------- ASSEMBLE ---------- */
  drawCover();
  doc.addPage();
  drawExecSummary();
  doc.addPage();
  drawMetrics();
  doc.addPage();
  drawWhatsWorking();
  doc.addPage();
  drawRedFlags();
  doc.addPage();
  drawWalkAway();
  if (compareMeta) {
    doc.addPage();
    drawCompareHeadToHead();
  }
  const safeSub = clean(suburbName).replace(/\s+/g, "-") || "Property";
  const fileName = `PropAI-Report-${safeSub}-${stateCode}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
