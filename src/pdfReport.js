import { jsPDF } from "jspdf";

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
      s =
        s.slice(0, startM.index) +
        tail.slice(endM.index + endM[0].length);
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

function stripMarkdownSymbols(text) {
  let s = String(text || "");
  s = s.replace(/\*\*([^*]*)\*\*/g, "$1");
  s = s.replace(/__(.*?)__/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/^#{1,6}\s*/gm, "");
  s = s.replace(/^[-*+]\s+/gm, "");
  s = s.replace(/^\s*[-*_]{3,}\s*$/gm, "");
  s = s.replace(/--+/g, " ");
  s = s.replace(/\*+/g, "");
  return s.replace(/\s+/g, " ").trim();
}

function stripMarkdownForPdf(text) {
  return stripMarkdownSymbols(text);
}

const stripEmojis = (text) => {
  return String(text)
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu,
      ""
    )
    .trim();
};

function cleanPdfTitle(s) {
  return stripEmojis(stripMarkdownSymbols(String(s || "")))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 92);
}

function extractReportTitle(analysisText) {
  const raw = String(analysisText || "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 45);

  for (const line of head) {
    const house = line.match(/\u{1F3E1}\s*(.+)/u);
    if (house) {
      const t = cleanPdfTitle(house[1]);
      if (t) return t;
    }
  }

  const auState = /\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i;
  for (const line of head) {
    const plain = stripMarkdownSymbols(line);
    const m = plain.match(
      /^(.+?),\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b\.?$/i
    );
    if (m && m[1].length >= 2 && m[1].length < 85) {
      const t = cleanPdfTitle(`${m[1].trim()}, ${m[2].toUpperCase()}`);
      if (t) return t;
    }
  }

  const blob = raw.slice(0, 3500);
  const anywhere = blob.match(
    /\b([A-Za-z][A-Za-z]+(?:\s+[A-Za-z]+){0,2}),\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/
  );
  if (anywhere) {
    const t = cleanPdfTitle(`${anywhere[1].trim()}, ${anywhere[2].toUpperCase()}`);
    if (t) return t;
  }

  return "Property investment report";
}

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

function parsePropaiMetrics(text) {
  if (!text) return [];
  const section = text.match(/##\s*METRICS SNAPSHOT\s*([\s\S]*?)(?=##\s|\[\[PROPAI|$)/i);
  if (!section) return [];
  const lines = section[1].split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (/^\|?\s*-+\s*\|/.test(line) || /\|\s*Metric\s*\|/i.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 3) rows.push({ metric: cells[0], value: cells[1], grade: cells[2] });
  }
  return rows;
}

function parsePropaiBullCase(text) {
  if (!text) return [];
  const section = text.match(/##\s*BULL CASE\s*([\s\S]*?)(?=##\s|\[\[PROPAI|$)/i);
  if (!section) return [];
  const items = [];
  const lines = section[1].split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (m) items.push(m[2].trim());
    else if (/^[-*\u2022]\s+/u.test(line)) items.push(line.replace(/^[-*\u2022]\s+/u, "").trim());
    else if (/^[A-Za-z][A-Za-z\s()]+:\s+.+/.test(line)) items.push(line.trim());
  }
  return items.filter(Boolean);
}

function parsePropaiBearCase(text) {
  if (!text) return [];
  const section = text.match(/##\s*BEAR CASE\s*([\s\S]*?)(?=##\s|\[\[PROPAI|$)/i);
  if (!section) return [];
  const items = [];
  const lines = section[1].split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^\*{0,2}([^:*]+?)\*{0,2}\s*[:\u2013\u2014-]\s*(.+)$/u);
    if (m) {
      items.push({ title: m[1].trim(), body: m[2].trim() });
    } else if (/^[-*\u2022]\s+/u.test(line)) {
      const body = line.replace(/^[-*\u2022]\s+/u, "").trim();
      if (body) items.push({ title: "Risk", body });
    }
  }
  return items;
}

function extractSection(text, tag) {
  if (!text) return "";
  const re = new RegExp(`\\[\\[${tag}_START\\]\\]([\\s\\S]*?)\\[\\[${tag}_END\\]\\]`);
  const m = text.match(re);
  return m ? m[1].trim() : "";
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
  const promptMatch = cleanedPrompt.match(/\b([A-Za-z][A-Za-z\s'-]{1,40})\s+(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\b/i);
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

function normalizeCompareWinner(data) {
  const win = data?.winner || {};
  return {
    name: String(win.name || "").trim(),
    reason: String(win.reason || "").trim()
  };
}

function firstNonEmptyCompareValue(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return v;
  }
  return "";
}

function parseNamedValueFromCombinedField(fieldValue, suburbA, suburbB) {
  const raw = String(fieldValue || "");
  const out = { a: "", b: "" };
  const reA = new RegExp(`${suburbA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-]\\s*([^|]+)`, "i");
  const reB = new RegExp(`${suburbB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-]\\s*([^|]+)`, "i");
  const a = raw.match(reA);
  const b = raw.match(reB);
  if (a) out.a = a[1].trim();
  if (b) out.b = b[1].trim();
  return out;
}

function parseNamedScore(text, suburbName) {
  const re = new RegExp(`${suburbName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,80}?(\\d{1,3})\\s*\\/\\s*100`, "i");
  const m = String(text || "").match(re);
  return m ? m[1] : "";
}

function parseNamedVerdict(text, suburbName) {
  const re = new RegExp(`${suburbName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,80}?\\b(BUY|HOLD|SKIP)\\b`, "i");
  const m = String(text || "").match(re);
  return m ? m[1].toUpperCase() : "";
}

function buildCompareDataFromText() {
  return null;
}

export function buildBrandedPdf(analysisText, options = {}) {
  const compareMeta = options.compareMeta;
  const cashflowBody = extractSection(analysisText, "CASHFLOW");
  const src = stripPdfThinkingPreamble(stripPropaiCompareBlock(analysisText));

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const PW = 210;
  const PH = 297;
  const MX = 20;

  const CREAM = [245, 239, 227];
  const CREAM_DEEP = [237, 229, 211];
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
    doc.text(String(sectionLabel).toUpperCase(), PW - MX, 22, { align: "right", charSpace: 0.8 });
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
    doc.text("PROPAI  �  AUSTRALIAN PROPERTY INTELLIGENCE", MX, PH - 12, { charSpace: 0.4 });
    doc.setFont("times", "italic");
    doc.setFontSize(9);
    doc.text(String(pageRoman), PW - MX, PH - 12, { align: "right" });
  };

  const drawEyebrow = (text, x, y) => {
    setText(FOREST);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(String(text).toUpperCase(), x, y, { charSpace: 0.8 });
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
  const parsedScore = parsePropaiScore(analysisText);
  const score = parsedScore != null ? parsedScore : null;
  const scoreLabel = parsedScore != null ? String(parsedScore) : "";
  const scoreMax = "100";
  const scorePct = parsedScore != null ? Math.min(1, parsedScore / 100) : 0;
  const parsedVerdict = parsePropaiVerdict(analysisText);
  const verdict = parsedVerdict || "Data unavailable";
  const walkAway = parsePropaiWalkaway(analysisText);
  const thesisMatch = src.match(/(?:^|\n\n)([A-Z][^\n]{40,200}[.!])/);
  const thesis = thesisMatch ? clean(thesisMatch[1]) : `A rentvestor-grade analysis of ${suburbName}.`;
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const verdictColor =
    verdict === "BUY"
      ? FOREST
      : verdict === "SKIP"
        ? CRIMSON
        : verdict === "HOLD"
          ? AMBER
          : INK_MUTED;
  const refBase = compareMeta ? String(compareMeta.suburb1 || "SUB") : suburbName;
  const refPrefix = refBase.replace(/\s.*/, "").slice(0, 3).toUpperCase() || "RPT";

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
    label: clean(row.metric || "Data unavailable"),
    value: clean(row.value || "Data unavailable") || "Data unavailable",
    grade: clean(row.grade || "Data unavailable") || "Data unavailable"
  }));
  while (metrics.length < 6) {
    const label = requiredMetricNames[metrics.length] || "Data unavailable";
    metrics.push({ label, value: "Data unavailable", grade: "Data unavailable" });
  }

  const workingItems = parsePropaiBullCase(analysisText).map((x) => String(x || "").trim()).filter(Boolean);
  const flagItems = parsePropaiBearCase(analysisText).filter((item) => {
    const title = String(item?.title || "").toLowerCase();
    const body = String(item?.body || "").toLowerCase();
    const combined = `${title} ${body}`;
    return !/(principal|interest|rates|insurance|strata|mortgage|repayments|rent\s*\$|cashflow)/i.test(combined);
  });
  const compareBlockParsed = parsePropaiCompareBlock(analysisText);

  if (!compareMeta) {
    if (isInvalidSuburbLabel(suburbName)) {
      throw new Error("PDF generation failed: suburb name was not parsed reliably. Please rerun analysis with explicit suburb and state.");
    }
    if (score == null) {
      throw new Error("PDF generation failed: missing [[PROPAI_SCORE]] value. Please regenerate analysis.");
    }
    if (!walkAway || !/\$\s*\d/.test(walkAway)) {
      throw new Error("PDF generation failed: missing [[PROPAI_WALKAWAY]] dollar range. Please regenerate analysis.");
    }
    if (!workingItems.length) {
      throw new Error("PDF generation failed: BULL CASE content is missing. Please regenerate analysis.");
    }
    if (!flagItems.length) {
      throw new Error("PDF generation failed: BEAR CASE content is missing or malformed. Please regenerate analysis.");
    }
  }

  const finalCallSection = src.match(/##\s*FINAL CALL\s*([\s\S]*?)(?=##\s|\[\[PROPAI|$)/i);
  const finalCallLineFallback = src.match(/(?:^|\n)\s*(BUY|HOLD|SKIP)\b[^\n]{12,220}/i);
  const finalCallText = (() => {
    if (finalCallSection?.[1]) {
      const firstLine = finalCallSection[1]
        .split("\n")
        .map((l) => clean(l))
        .find(Boolean);
      if (firstLine) return firstLine;
    }
    if (finalCallLineFallback) return clean(finalCallLineFallback[0]);
    if (verdict === "BUY" || verdict === "HOLD" || verdict === "SKIP") {
      return `${verdict} ? data-backed recommendation based on current parsed metrics and risk profile.`;
    }
    return "Data unavailable";
  })();

  const reportTitle = compareMeta
    ? `${compareMeta.suburb1} vs ${compareMeta.suburb2} ${compareMeta.state || ""}`.trim()
    : suburbName;
  const compareFromText = buildCompareDataFromText(analysisText, reportTitle);
  const coverSubtitle = compareMeta
    ? `A rentvestor's analysis of ${compareMeta.suburb1} vs ${compareMeta.suburb2}, prepared by PropAI. Deal Score, Walk-Away Number, and full negotiation strategy inside.`
    : `A rentvestor's analysis of ${suburbName}, prepared by PropAI. Deal Score, Walk-Away Number, and full negotiation strategy inside.`;
  const compareNameA = clean(String(compareMeta?.suburb1 || suburbName.split(/\s+vs\s+/i)[0] || "Suburb A"));
  const compareNameB = clean(String(compareMeta?.suburb2 || suburbName.split(/\s+vs\s+/i)[1] || "Suburb B"));
  const metricByLabel = Object.fromEntries(metrics.map((m) => [String(m.label || "").toLowerCase(), m.value]));
  const yieldPair = parseNamedValueFromCombinedField(metricByLabel["rental yield"], compareNameA, compareNameB);
  const growthPair = parseNamedValueFromCombinedField(metricByLabel["capital growth"], compareNameA, compareNameB);
  const fallbackCompareData = {
    suburb1: {
      name: compareNameA,
      score: parseNamedScore(analysisText, compareNameA),
      yield: yieldPair.a || "Data unavailable",
      growth: growthPair.a || "Data unavailable",
      verdict: parseNamedVerdict(analysisText, compareNameA) || parsedVerdict || "Data unavailable"
    },
    suburb2: {
      name: compareNameB,
      score: parseNamedScore(analysisText, compareNameB),
      yield: yieldPair.b || "Data unavailable",
      growth: growthPair.b || "Data unavailable",
      verdict: parseNamedVerdict(analysisText, compareNameB) || parsedVerdict || "Data unavailable"
    },
    winner: { name: "", reason: "" }
  };
  const jsonCompareData =
    compareBlockParsed?.data?.suburb1 && compareBlockParsed?.data?.suburb2
      ? compareBlockParsed.data
      : null;
  const pickCompareSuburb = (jsonSuburb, textSuburb, fallbackSuburb, nameFallback) => ({
    name: firstNonEmptyCompareValue(jsonSuburb?.name, textSuburb?.name, fallbackSuburb?.name, nameFallback) || nameFallback,
    score: firstNonEmptyCompareValue(jsonSuburb?.score, textSuburb?.score, fallbackSuburb?.score),
    yield: firstNonEmptyCompareValue(jsonSuburb?.yield, textSuburb?.yield, fallbackSuburb?.yield),
    growth: firstNonEmptyCompareValue(jsonSuburb?.growth, textSuburb?.growth, fallbackSuburb?.growth),
    verdict: firstNonEmptyCompareValue(jsonSuburb?.verdict, textSuburb?.verdict, fallbackSuburb?.verdict)
  });
  const effectiveCompareData =
    compareMeta
      ? {
          suburb1: pickCompareSuburb(jsonCompareData?.suburb1, compareFromText?.suburb1, fallbackCompareData.suburb1, compareNameA),
          suburb2: pickCompareSuburb(jsonCompareData?.suburb2, compareFromText?.suburb2, fallbackCompareData.suburb2, compareNameB),
          winner: jsonCompareData?.winner || { name: "", reason: "" }
        }
      : fallbackCompareData;
  const formatCompareScore = (v) => {
    if (v == null || v === "") return "Data unavailable";
    if (typeof v === "number") return `${v}/100`;
    const s = String(v).trim();
    const embedded = s.match(/(\d{1,3})\s*\/\s*100/i);
    if (embedded) return `${embedded[1]}/100`;
    if (/^\d{1,3}$/.test(s)) return `${s}/100`;
    return s;
  };

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
    doc.text(`REF � ${refPrefix}-${postcode || "0000"}-001`, rightX, 28, { align: "right", charSpace: 0.6 });
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
    const subtitleLines = doc.splitTextToSize(coverSubtitle, PW - 2 * MX - 40);
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
    doc.text(walkAway, PW - MX, PH - 28, { align: "right" });
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
    doc.text(`VERDICT  �  ${verdict}`, pillX + 12, pillY + 7.5, { charSpace: 1 });
  };

  const drawExecSummary = () => {
    paintBg(PAPER);
    drawPageHead(`${suburbName} ${stateCode}`);
    drawEyebrow("EXECUTIVE SUMMARY", MX, 42);
    drawTitleTwoTone("The ", "thesis,", MX, 60, 28);
    drawTitleTwoTone("in one ", "page.", MX, 72, 28);
    setText(INK_SOFT);
    doc.setFont("times", "italic");
    doc.setFontSize(13);
    const thLines = doc.splitTextToSize(thesis, PW - 2 * MX - 20);
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
      const cfLines = doc.splitTextToSize(clean(stripMarkdownSymbols(cashflowBody)), PW - 2 * MX);
      let ly = 184;
      for (let ci = 0; ci < cfLines.length; ci++) {
        if (ly > PH - 28) break;
        doc.text(cfLines[ci], MX, ly);
        ly += 4.6;
      }
    }
    drawPageFoot("ii");
  };

  const drawMetrics = () => {
    paintBg(PAPER);
    drawPageHead("KEY METRICS");
    drawEyebrow("METRICS SNAPSHOT", MX, 42);
    drawTitleTwoTone("Seven numbers", "", MX, 60, 28);
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
      doc.text(metric.label.toUpperCase(), x + 5, y + 7, { charSpace: 0.6 });
      setText(isFeature ? CREAM : INK);
      doc.setFont("times", "normal");
      const valueStr = String(metric.value || "Data unavailable");
      doc.setFontSize(valueStr.length > 20 ? 14 : 20);
      doc.text(valueStr.substring(0, 18), x + 5, y + 20);
    });
    drawPageFoot("iii");
  };

  const drawWhatsWorking = () => {
    paintBg(PAPER);
    drawPageHead("WHAT'S WORKING");
    drawEyebrow("BULL CASE", MX, 42);
    drawTitleTwoTone(`Why ${suburbName}`, "", MX, 60, 28);
    drawTitleTwoTone("is ", "moving.", MX, 72, 28);
    const contentBottom = PH - 18;
    const listStart = 88;
    const nWork = Math.max(workingItems.length, 1);
    const slotH = (contentBottom - listStart) / nWork;
    workingItems.forEach((item, i) => {
      const workY = listStart + i * slotH;
      const num = String(i + 1).padStart(2, "0");
      setText(FOREST);
      doc.setFont("times", "italic");
      doc.setFontSize(22);
      doc.text(num, MX, workY);
      setText(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`Reason ${i + 1}`, MX + 14, workY - 2);
      setText(INK_SOFT);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const bodyLines = doc.splitTextToSize(String(item), PW - 2 * MX - 14);
      let by = workY + 4;
      bodyLines.slice(0, 4).forEach((line) => {
        doc.text(line, MX + 14, by, { maxWidth: PW - 2 * MX - 14 });
        by += 4.5;
      });
    });
    drawPageFoot("iv");
  };

  const drawRedFlags = () => {
    paintBg(PAPER);
    drawPageHead("RED FLAGS");
    drawEyebrow("BEAR CASE", MX, 42);
    drawTitleTwoTone("What could", "", MX, 60, 28);
    drawTitleTwoTone("go ", "wrong.", MX, 72, 28);
    const flagContentBottom = PH - 18;
    const flagListStart = 86;
    const nFlags = Math.max(flagItems.length, 1);
    const flagSlotH = (flagContentBottom - flagListStart) / nFlags;
    flagItems.forEach((item, i) => {
      const flagY = flagListStart + i * flagSlotH;
      setFill([251, 238, 235]);
      doc.circle(MX + 4, flagY + 1, 3.5, "F");
      setText(CRIMSON);
      doc.setFont("times", "italic");
      doc.setFontSize(13);
      doc.text("!", MX + 4, flagY + 3, { align: "center" });
      setText(CRIMSON);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text((item.title || "Risk").substring(0, 50), MX + 11, flagY);
      setText(INK_SOFT);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const bearLine = `${item.title || "Risk"}: ${item.body || ""}`;
      const bLines = doc.splitTextToSize(bearLine, PW - 2 * MX - 11);
      let fy = flagY + 6;
      bLines.slice(0, 3).forEach((line) => {
        doc.text(line, MX + 11, fy);
        fy += 4.5;
      });
    });
    drawPageFoot("v");
  };

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
    doc.text(walkAway, MX + 10, 108);
    setText(PAPER);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("FINAL CALL  �  ACTIONABLE", MX + 10, 148, { charSpace: 0.9 });
    doc.setFont("times", "normal");
    doc.setFontSize(17);
    const fcLines = doc.splitTextToSize(finalCallText.substring(0, 140), PW - 2 * MX - 20);
    doc.text(fcLines, MX + 10, 160);
    drawPageFoot("vi");
  };

  const drawCompareHeadToHead = () => {
    paintBg(PAPER);
    drawPageHead("HEAD-TO-HEAD");
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
    doc.setFontSize(10);
    doc.text(n1, MX, 64);
    doc.text(n2, MX + (PW - 2 * MX) / 2, 64);
    const rows = [
      { label: "SCORE", a: formatCompareScore(s1?.score), b: formatCompareScore(s2?.score) },
      { label: "YIELD", a: valueOrUnavailable(s1?.yield), b: valueOrUnavailable(s2?.yield) },
      { label: "GROWTH", a: valueOrUnavailable(s1?.growth), b: valueOrUnavailable(s2?.growth) },
      { label: "VERDICT", a: valueOrUnavailable(s1?.verdict), b: valueOrUnavailable(s2?.verdict) }
    ];
    let cy = 86;
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
        doc.text(String(val).substring(0, 22), x + 4, cy + 16);
      });
      cy += 26;
    });
    if (win.name) {
      setText(FOREST);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`Winner: ${win.name}`, MX, cy + 4);
    }
    drawPageFoot("vii");
  };

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
