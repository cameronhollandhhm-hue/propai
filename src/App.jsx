import React, { useState, useRef, useEffect, useMemo } from "react";
import { jsPDF } from "jspdf";

// ─── MEGA SYSTEM PROMPT ───────────────────────────────────────────────────────
const SYSTEM = `You are PropAI — an elite Australian property investment analyst. Search the web for live data before every answer.

For SUBURB analysis output exactly:
🏡 [SUBURB, STATE]
⭐ DEAL SCORE: X/100 | [💰 CASH FLOW / 📈 GROWTH / ⚖️ BALANCED]
⚡ QUICK TAKE: [growth signal] | [cashflow] | [who it suits]
👉 VERDICT: BUY / WATCH / AVOID
📊 SCORE BREAKDOWN: Growth X/30 | Yield X/20 | Demand X/20 | Fundamentals X/15 | Liquidity X/15
📊 DATA: Median $ | 12m% | Yield% | Rent$/wk | Vacancy% | DOM days | Confidence HIGH/MED/LOW
📈 MARKET: [3 lines — what's driving this NOW]
💸 CASHFLOW: Rent $ | Mortgage $ | Net +/-$/wk (20% deposit, 3.85% rate)
⚠️ RISKS: [2-3 specific risks]
🎯 GAME PLAN: Buy $Xk-$Xk | Type | Compare: [2 suburbs]
🧠 CONFIDENCE: HIGH/MED/LOW (X/10)
💡 INVESTOR EDGE: [demand driver] | [supply constraint] | [forward thesis]
🎯 FINAL CALL: If this were my money: 👉 I would BUY/WAIT/PASS at $X. Reason: [one line]

For DEAL analysis (user gives suburb + price + rent) output:
🏠 DEAL ANALYSIS — [SUBURB]
⭐ DEAL SCORE: X/100
👉 INSTANT VERDICT: BUY/NEGOTIATE/AVOID — [one sentence]
📊 Purchase $ | Rent $/wk | Yield% | Deposit $ | Stamp Duty $ | Total Cash $
💸 Rent $ | Mortgage $ | Rates+Mgmt $ | NET +/-$/wk → +/-$/yr
💰 VALUE SIGNAL: Est. Market Value $Xk-$Xk | Asking $Xk | 👉 UNDERVALUED/FAIR VALUE/OVERPRICED ~$Xk
🎯 NEGOTIATION: Target $Xk | Walk Away $Xk | Opening $Xk | Tactic 1 | Tactic 2 | Tactic 3
🔍 WHY THIS DEAL EXISTS: [3 reasons]
🔁 BETTER ALTERNATIVE: [suburb] — [why]
🧠 CONFIDENCE: X/10
💡 INVESTOR EDGE: [insider angle]
🎯 FINAL CALL: 👉 BUY/NEGOTIATE/PASS at $X. Reason: [one line]

For DAILY DEALS output:
🔥 TODAY'S TOP DEALS
🏆 DEAL OF THE DAY: [Suburb] Score X/100 | Value signal | Cashflow | 👉 BUY
📋 2-5: [Suburb] — X/100 | [one line each]
⚠️ AVOID: [Suburb] — [why]

Rules: Search web first. Max 3-4 lines per section. No padding. RBA rate 3.85%. Always recommend mortgage broker + conveyancer.`;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function normalizeComparePayload(data) {
  if (!data || typeof data !== "object") return data;
  const o = { ...data };
  if (!o.suburb1 && o.Suburb1) o.suburb1 = o.Suburb1;
  if (!o.suburb2 && o.Suburb2) o.suburb2 = o.Suburb2;
  return o;
}

function tryParseCompareJsonBlob(inner) {
  let raw = String(inner || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  raw = raw.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const tryJson = (s) => {
    try {
      const d = JSON.parse(s);
      return normalizeComparePayload(d);
    } catch {
      return null;
    }
  };
  let data = tryJson(raw);
  if (data?.suburb1 && data?.suburb2) return data;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    let slice = raw.slice(start, end + 1);
    data = tryJson(slice);
    if (data?.suburb1 && data?.suburb2) return data;
    slice = slice.replace(/,\s*([\]}])/g, "$1");
    data = tryJson(slice);
    if (data?.suburb1 && data?.suburb2) return data;
  }
  return null;
}

/** Find balanced { ... } for compare JSON (respects strings so } inside values does not break). */
function findCompareObjectSpan(raw) {
  const low = raw.toLowerCase();
  let idx = low.indexOf('"suburb1"');
  if (idx === -1) idx = low.indexOf("'suburb1'");
  if (idx === -1) return null;
  let start = idx;
  while (start > 0 && raw[start] !== "{") start--;
  if (raw[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let q = null;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      q = c;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return null;
}

/** @returns {{ data: object, prose: string } | null} */
function parsePropaiCompareBlock(text) {
  const raw = String(text || "");
  let m = raw.match(PROP_COMPARE_RE_FULL);
  if (!m) m = raw.match(PROP_COMPARE_RE_SINGLE);
  if (!m) {
    const startM = raw.match(/\[\[?\s*PROPAI_COMPARE\s*\]?\]/i);
    if (startM) {
      const from = startM.index + startM[0].length;
      const tail = raw.slice(from);
      const endM = tail.match(/\[\[?\s*\/\s*PROPAI_COMPARE\s*\]?\]/i);
      const inner = endM ? tail.slice(0, endM.index) : tail;
      const data = tryParseCompareJsonBlob(inner);
      if (data?.suburb1 && data?.suburb2) {
        return { data, prose: stripPropaiCompareBlock(raw) };
      }
    }
    const fenced = raw.match(
      /```(?:json)?\s*(\{[\s\S]*?"suburb1"[\s\S]*?\})\s*```/i
    );
    if (fenced) {
      const data = tryParseCompareJsonBlob(fenced[1]);
      if (data?.suburb1 && data?.suburb2) {
        return { data, prose: stripPropaiCompareBlock(raw) };
      }
    }
    const looseA = tryParseLooseCompareBlock(raw);
    if (looseA) return looseA;
    return null;
  }
  const data = tryParseCompareJsonBlob(m[1]);
  if (!data?.suburb1 || !data?.suburb2) {
    const looseB = tryParseLooseCompareBlock(raw);
    if (looseB) return looseB;
    return null;
  }
  const prose = stripPropaiCompareBlock(raw);
  return { data, prose };
}

function tryParseLooseCompareBlock(raw) {
  const span = findCompareObjectSpan(raw);
  if (!span) return null;
  const blob = raw.slice(span.start, span.end);
  const data = tryParseCompareJsonBlob(blob);
  if (!data?.suburb1 || !data?.suburb2) return null;
  let prose = raw.slice(0, span.start) + raw.slice(span.end);
  prose = stripPropaiCompareBlock(prose);
  return { data, prose: prose.trim() };
}

function normalizeCompareWinner(data) {
  const w = data?.winner;
  if (!w) return { name: "", reason: "" };
  if (typeof w === "string") return { name: w, reason: "" };
  return {
    name: w.name || w.suburb || "",
    reason: w.reason || w.summary || ""
  };
}

function verdictBadgeStyles(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "BUY") return { bg: "#dcfce7", fg: "#166534", label: "BUY" };
  if (v === "NEGOTIATE" || v === "WATCH") return { bg: "#ffedd5", fg: "#c2410c", label: v === "WATCH" ? "WATCH" : "NEGOTIATE" };
  if (v === "SKIP" || v === "AVOID") return { bg: "#fee2e2", fg: "#b91c1c", label: v === "AVOID" ? "AVOID" : "SKIP" };
  return { bg: "#f3f4f6", fg: "#374151", label: verdict || "—" };
}

function CompareSuburbCards({ data, stateLabel }) {
  const s1 = data.suburb1;
  const s2 = data.suburb2;
  const win = normalizeCompareWinner(data);
  const brandGreen = "#2d5a27";
  const card = (s, side) => {
    const vb = verdictBadgeStyles(s.verdict);
    return (
      <div
        key={side}
        style={{
          flex: "1 1 260px",
          minWidth: 220,
          background: "#ffffff",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          border: "1px solid rgba(45,90,39,0.15)"
        }}
      >
        <div
          style={{
            background: brandGreen,
            color: "#fff",
            padding: "12px 14px",
            fontFamily: "'Syne',sans-serif",
            fontWeight: 800,
            fontSize: 15,
            letterSpacing: "-0.02em"
          }}
        >
          {s.name || "—"}
          {stateLabel ? (
            <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.9, marginLeft: 8 }}>{stateLabel}</span>
          ) : null}
        </div>
        <div style={{ padding: "14px 16px", color: "#1f2937", fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, lineHeight: 1.65 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Score</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: brandGreen }}>{s.score != null ? `${s.score}/100` : "—"}</div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: "#6b7280" }}>Yield </span>
            <span style={{ fontWeight: 600 }}>{s.yield || "—"}</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ color: "#6b7280" }}>Growth </span>
            <span style={{ fontWeight: 600 }}>{s.growth || "—"}</span>
          </div>
          <div>
            <span
              style={{
                display: "inline-block",
                padding: "4px 10px",
                borderRadius: 999,
                background: vb.bg,
                color: vb.fg,
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: "0.04em"
              }}
            >
              {vb.label}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "stretch" }}>
        {card(s1, "1")}
        {card(s2, "2")}
      </div>
      {win.name || win.reason ? (
        <div
          style={{
            marginTop: 14,
            padding: "14px 16px",
            borderRadius: 10,
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
            border: "1px solid rgba(45,90,39,0.25)",
            color: "#14532d",
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 12,
            lineHeight: 1.55
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 11, color: brandGreen, marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Winner — {win.name || "See analysis"}
          </div>
          <div>{win.reason || ""}</div>
        </div>
      ) : null}
    </div>
  );
}

function renderAssistantContent(m) {
  const parsed = parsePropaiCompareBlock(m.text);
  const showCompare = !!parsed?.data;
  return React.createElement(
    React.Fragment,
    null,
    showCompare &&
      React.createElement(CompareSuburbCards, {
        data: parsed.data,
        stateLabel: m.compareMeta?.state
      }),
    renderChatContent(parsed?.prose ?? m.text)
  );
}

function isMarkdownTableDivider(line) {
  const t = line.trim();
  if (!t.includes("|") || !/-/.test(t)) return false;
  return /^[\s|:\-]+$/.test(t);
}

function isTableRowLine(line) {
  const t = line.trim();
  return t.includes("|") && t.length >= 2;
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Bold **segments**, strip stray markdown noise in chat. */
function formatInlineChatParts(text) {
  const s = String(text ?? "");
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, j) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      const inner = p.slice(2, -2).replace(/#{1,6}\s*/g, "").replace(/--+/g, " ");
      return React.createElement("strong", { key: j, style: { color: "#e8b84b" } }, inner);
    }
    let rest = p.replace(/\*([^*]+)\*/g, "$1").replace(/\*+/g, "");
    rest = rest.replace(/#{1,6}\s*/g, "");
    rest = rest.replace(/--+/g, " ");
    rest = rest.replace(/`+/g, "");
    return rest.length ? React.createElement("span", { key: j }, rest) : null;
  });
}

function normalizeChatLineHashes(line) {
  return String(line)
    .replace(/^#{1,6}\s*/, "")
    .replace(/--+/g, " ")
    .trim();
}

function tryConsumeMarkdownTable(lines, startIdx) {
  if (!isTableRowLine(lines[startIdx])) return null;
  const headerCells = splitMarkdownTableRow(lines[startIdx]);
  let j = startIdx + 1;
  if (j < lines.length && isMarkdownTableDivider(lines[j])) {
    j += 1;
    const bodyRows = [];
    while (j < lines.length && isTableRowLine(lines[j])) {
      bodyRows.push(splitMarkdownTableRow(lines[j]));
      j += 1;
    }
    return { endIdx: j, headerCells, bodyRows };
  }
  if (j < lines.length && isTableRowLine(lines[j])) {
    const bodyRows = [];
    while (j < lines.length && isTableRowLine(lines[j])) {
      if (isMarkdownTableDivider(lines[j])) {
        j += 1;
        continue;
      }
      bodyRows.push(splitMarkdownTableRow(lines[j]));
      j += 1;
    }
    return { endIdx: j, headerCells, bodyRows };
  }
  return null;
}

function ChatMarkdownTable({ headerCells, bodyRows }) {
  const maxCols = Math.max(
    headerCells.length,
    ...bodyRows.map((r) => r.length),
    1
  );
  const pad = (cells) => {
    const c = [...cells];
    while (c.length < maxCols) c.push("");
    return c;
  };
  const head = pad(headerCells);
  const body = bodyRows.map(pad);
  return (
    <div style={{ overflowX: "auto", marginBottom: 10, marginTop: 4 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          border: "1px solid #52525b"
        }}
      >
        <thead>
          <tr style={{ background: "#1c1f26" }}>
            {head.map((c, i) => (
              <th
                key={i}
                style={{
                  border: "1px solid #52525b",
                  padding: "8px 10px",
                  textAlign: "left",
                  color: "#e8e6e0",
                  fontWeight: 600
                }}
              >
                {formatInlineChatParts(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr
              key={ri}
              style={{ background: ri % 2 === 0 ? "#14161c" : "#0e1117" }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    border: "1px solid #52525b",
                    padding: "7px 10px",
                    color: "#d4d4d8",
                    verticalAlign: "top"
                  }}
                >
                  {formatInlineChatParts(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderChatContent(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let key = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      out.push(React.createElement("div", { key: `s${key++}`, style: { height: 6 } }));
      i += 1;
      continue;
    }

    const tableBlock = tryConsumeMarkdownTable(lines, i);
    if (tableBlock) {
      out.push(
        React.createElement(ChatMarkdownTable, {
          key: `t${key++}`,
          headerCells: tableBlock.headerCells,
          bodyRows: tableBlock.bodyRows
        })
      );
      i = tableBlock.endIdx;
      continue;
    }

    if (/^\s*[-*_]{3,}\s*$/.test(trimmed)) {
      out.push(React.createElement("div", { key: `r${key++}`, style: { height: 4 } }));
      i += 1;
      continue;
    }

    const isHeading = /^#{1,6}\s*\S/.test(line.trim());
    if (isHeading) {
      const content = normalizeChatLineHashes(line);
      out.push(
        React.createElement(
          "div",
          {
            key: `h${key++}`,
            style: {
              fontWeight: 700,
              color: "#e8e6e0",
              marginBottom: 6,
              marginTop: 4,
              fontSize: 14,
              lineHeight: 1.45
            }
          },
          formatInlineChatParts(content)
        )
      );
      i += 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    const numMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (bulletMatch || numMatch) {
      const inner = bulletMatch ? bulletMatch[1] : numMatch[1];
      out.push(
        React.createElement(
          "div",
          { key: `b${key++}`, style: { display: "flex", gap: 8, marginBottom: 4 } },
          React.createElement("span", { style: { color: "#e8b84b", flexShrink: 0 } }, "•"),
          React.createElement("span", null, formatInlineChatParts(inner))
        )
      );
      i += 1;
      continue;
    }

    const normalized = normalizeChatLineHashes(line);
    if (!normalized) {
      i += 1;
      continue;
    }

    out.push(
      React.createElement(
        "div",
        { key: `p${key++}`, style: { marginBottom: 3, lineHeight: 1.75 } },
        formatInlineChatParts(normalized)
      )
    );
    i += 1;
  }
  return out;
}

/** Remove markdown tokens so PDF shows clean prose (##, **, *, --, bullets, hr lines). */
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
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function stripMarkdownForPdf(text) {
  return stripMarkdownSymbols(text);
}

function cleanPdfTitle(s) {
  return stripEmojis(stripMarkdownSymbols(String(s || "")))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 92);
}

/**
 * Prefer real suburb / location from analysis (emoji lines, "Suburb, STATE", deal/compare).
 */
function extractReportTitle(analysisText) {
  const raw = String(analysisText || "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 45);

  for (const line of head) {
    const house = line.match(/🏡\s*(.+)/u);
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

  for (const line of head) {
    if (/🏠/u.test(line) && /DEAL\s+ANALYSIS/i.test(line)) {
      const t = cleanPdfTitle(line.replace(/^🏠\s*/u, ""));
      if (t) return t;
    }
    if (/^DEAL\s+ANALYSIS/i.test(stripMarkdownSymbols(line))) {
      const t = cleanPdfTitle(line);
      if (t) return t;
    }
  }

  for (const line of head) {
    if (/🔥/u.test(line) && /TODAY'?S\s+TOP\s+DEALS/i.test(line)) return "Today's top deals";
    if (/^TODAY'?S\s+TOP\s+DEALS/i.test(stripMarkdownSymbols(line))) return "Today's top deals";
  }

  const withPcode = blob.match(
    /\b([A-Za-z][A-Za-z\s]+?),\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}\b/i
  );
  if (withPcode && withPcode[1].trim().length >= 2) {
    const t = cleanPdfTitle(`${withPcode[1].trim()}, ${withPcode[2].toUpperCase()}`);
    if (t) return t;
  }

  const plainLines = stripMarkdownForPdf(raw).split("\n").map((l) => l.trim()).filter(Boolean);
  const first = plainLines[0];
  if (first && first.length >= 8 && first.length < 95 && auState.test(first)) {
    const t = cleanPdfTitle(first);
    if (t) return t;
  }

  return "Property investment report";
}

function slugForFilename(title) {
  const s = title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 48) || "Analysis";
}

/* Pipes inside [] are literal; ranges below are unioned (same intent as user list). */
/* Union of ranges only — `|` inside [] is literal in JS, not alternation. */
const stripEmojis = (text) => {
  return String(text)
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu,
      ""
    )
    .trim();
};

const PDF = {
  forest: [45, 90, 39],
  forestSoft: [61, 106, 55],
  white: [255, 255, 255],
  body: [51, 51, 51],
  muted: [118, 128, 118]
};

function classifyPdfLine(rawLine) {
  const t = rawLine.trim();
  if (!t) return { kind: "blank" };
  if (/^[-*_]{3,}\s*$/.test(t)) return { kind: "rule" };
  const hm = t.match(/^(#{1,6})\s*(.*)$/);
  if (hm && hm[2] !== undefined) {
    const level = hm[1].length;
    return { kind: "heading", level: Math.min(level, 6), text: hm[2] };
  }
  return { kind: "body", text: t };
}

/** Strip non-ASCII (emojis, mojibake) so jsPDF never corrupts glyphs. */
function pdfAscii(text) {
  return String(text || "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

/** Remove Claude preamble lines at the top (thinking / search narration). */
function stripPdfThinkingPreamble(text) {
  const lines = String(text || "").split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "") {
      i += 1;
      continue;
    }
    if (isPdfThinkingPreambleLine(t)) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n");
}

function buildBrandedPdf(analysisText, options = {}) {
  const compareMeta = options.compareMeta;
  const strippedForTitle = stripPdfThinkingPreamble(
    stripPropaiCompareBlock(analysisText)
  );
  const title = pdfAscii(
    compareMeta
      ? cleanPdfTitle(`${compareMeta.suburbA} vs ${compareMeta.suburbB} - ${compareMeta.state}`)
      : extractReportTitle(strippedForTitle)
  );
  const dateStr = new Date().toLocaleDateString("en-AU", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const fileDate = new Date().toISOString().slice(0, 10);

  const rawLines = String(strippedForTitle || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  for (const rawLine of rawLines) {
    const item = classifyPdfLine(rawLine);
    if (item.kind === "blank") {
      blocks.push({ type: "blank" });
      continue;
    }
    if (item.kind === "rule") {
      blocks.push({ type: "rule" });
      continue;
    }
    if (item.kind === "heading") {
      const cleaned = pdfAscii(stripMarkdownSymbols(item.text));
      if (cleaned) blocks.push({ type: "heading", level: item.level, text: cleaned });
      continue;
    }
    const cleaned = pdfAscii(stripMarkdownSymbols(item.text));
    if (cleaned) blocks.push({ type: "body", text: cleaned });
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const headerH = 26;
  const footerH = 16;
  const bottomSafe = footerH + 6;
  let y = headerH + 14;

  const contHeaderH = 9;
  const newPage = () => {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageW, pageH, "F");
    doc.setFillColor(...PDF.forest);
    doc.rect(0, 0, pageW, contHeaderH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF.white);
    doc.text("PropAI - Property report", margin, 6);
    y = contHeaderH + 8;
  };

  const ensureSpace = (needMm) => {
    if (y + needMm > pageH - bottomSafe) newPage();
  };

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, "F");
  doc.setFillColor(...PDF.forest);
  doc.rect(0, 0, pageW, headerH, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...PDF.white);
  doc.text("PropAI", margin, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF.white);
  doc.text("Australian property intelligence", margin, 22);

  doc.setTextColor(...PDF.forest);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const titleLines = doc.splitTextToSize(title, contentW);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 6.5 + 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF.muted);
  doc.text(`Prepared ${dateStr}`, margin, y);
  y += 8;

  doc.setDrawColor(...PDF.forestSoft);
  doc.setLineWidth(0.35);
  doc.line(margin, y, pageW - margin, y);
  y += 9;

  const bodyLineH = 5;
  const headingSize = (lvl) => (lvl <= 2 ? 12 : lvl <= 4 ? 11 : 10);
  let sectionHeadingIndex = 0;

  for (const block of blocks) {
    if (block.type === "blank") {
      ensureSpace(4);
      y += 3.5;
      continue;
    }
    if (block.type === "rule") {
      ensureSpace(8);
      doc.setDrawColor(...PDF.forestSoft);
      doc.setLineWidth(0.25);
      doc.line(margin, y + 2, pageW - margin, y + 2);
      y += 7;
      continue;
    }
    if (block.type === "heading") {
      sectionHeadingIndex += 1;
      if (sectionHeadingIndex > 1) {
        ensureSpace(10);
        doc.setDrawColor(...PDF.forestSoft);
        doc.setLineWidth(0.2);
        doc.line(margin, y + 1, pageW - margin, y + 1);
        y += 6;
      }
      ensureSpace(16);
      const hs = headingSize(block.level);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(hs);
      doc.setTextColor(...PDF.forest);
      const lines = doc.splitTextToSize(block.text, contentW);
      const headLineGap = Math.max(5, hs * 0.42);
      for (let li = 0; li < lines.length; li++) {
        ensureSpace(headLineGap + 1);
        doc.text(lines[li], margin, y);
        y += headLineGap;
      }
      y += 2;
      doc.setFont("helvetica", "normal");
      continue;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...PDF.body);
    const paraLines = doc.splitTextToSize(block.text, contentW);
    for (let i = 0; i < paraLines.length; i++) {
      ensureSpace(bodyLineH + 1);
      doc.text(paraLines[i], margin, y);
      y += bodyLineH;
    }
    y += 3;
  }

  y += 4;
  ensureSpace(14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  const disclaimer = "Not financial advice. Consult a licensed adviser, mortgage broker, and conveyancer before making decisions.";
  const discLines = doc.splitTextToSize(disclaimer, contentW);
  let dy = y;
  for (let di = 0; di < discLines.length; di++) {
    ensureSpace(5);
    doc.text(discLines[di], margin, dy);
    dy += 4.2;
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text("Confidential - Generated by PropAI", margin, pageH - 10);
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 10, { align: "right" });
  }

  const fname = `PropAI-Report-${slugForFilename(title)}-${fileDate}.pdf`;
  doc.save(fname);
}

const FREE_LIMIT = 3;

/** Free-tier usage: only count when the assistant reply is real analysis, not API/stream failures. */
function shouldCountFreeSuccessfulAnalysis(text, hadNdjsonError) {
  if (hadNdjsonError) return false;
  const t = String(text || "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  const failures = [
    "timed out",
    "something went wrong",
    "couldn't pull",
    "could not pull",
    "no response stream",
    "connection interrupted",
    "busy right now",
    "try again in",
    "analysis took too long",
    "too long",
    "server error",
    "couldn't pull enough"
  ];
  return !failures.some((phrase) => lower.includes(phrase));
}

function extractPurchasePriceFromText(text) {
  const s = String(text || "");
  const candidates = [];
  const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(k|K)?/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (m[2]) v *= 1000;
    if (v >= 2e4 && v <= 5e7) candidates.push({ v, idx: m.index });
  }
  if (!candidates.length) return null;
  const lower = s.toLowerCase();
  let best = candidates[0].v;
  let bestScore = -Infinity;
  for (const { v, idx } of candidates) {
    const slice = lower.slice(Math.max(0, idx - 50), Math.min(lower.length, idx + 50));
    let score = 0;
    if (/purchase|asking|price|median|buy|valuation|market|listing|deal\s*score|walk\s*away|target\s*\$/.test(slice)) score += 3;
    if (/rent\s*\$|\$\s*[\d,]+\s*(?:\/|per)\s*week|weekly\s*rent|\/wk\b|pw\b/.test(slice)) score -= 2;
    if (score > bestScore || (score === bestScore && v > best)) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

function extractWeeklyRentFromText(text) {
  const s = String(text || "");
  const patterns = [
    /rent\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per)\s*week/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per)\s*week/i,
    /weekly\s*rent[:\s]+\$?\s*([\d,]+)/i,
    /([\d,]+)\s*\$\/wk/i,
    /\$\s*([\d,]+)\s*pw\b/i
  ];
  for (const p of patterns) {
    const x = s.match(p);
    if (x) return parseFloat(x[1].replace(/,/g, ""));
  }
  return null;
}

function shouldShowMortgageCalculator(text) {
  if (!text?.trim()) return false;
  if (!shouldCountFreeSuccessfulAnalysis(text, false)) return false;
  const t = text.toLowerCase();
  const hasMoney = /\$\s*[\d,]+/.test(text) || /\b\d{2,3},\d{3}\b/.test(text) || /\d{2,3}k\b/i.test(text);
  if (!hasMoney) return false;
  return /deal|score|suburb|purchase|median|yield|rent|valuation|cash\s*flow|\/100|property|walk.?away|negotiat/i.test(t);
}

function computeMortgageOutputs(price, depositPct, annualRatePct, termYears, repaymentMode, weeklyRent) {
  const loan = Math.max(0, price * (1 - depositPct / 100));
  const monthlyRate = annualRatePct / 100 / 12;
  const numPayments = termYears * 12;
  let monthlyRepayment = 0;
  if (loan > 0 && monthlyRate >= 0) {
    if (repaymentMode === "io") {
      monthlyRepayment = loan * monthlyRate;
    } else if (monthlyRate === 0) {
      monthlyRepayment = loan / numPayments;
    } else {
      monthlyRepayment =
        (loan * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
        (Math.pow(1 + monthlyRate, numPayments) - 1);
    }
  }
  const weeklyRepayment = (monthlyRepayment * 12) / 52;
  const monthlyRentEquiv = (weeklyRent * 52) / 12;
  const monthlyCashflow = monthlyRentEquiv - monthlyRepayment;
  const annualCashflow = monthlyCashflow * 12;
  const grossYieldPct = price > 0 ? ((weeklyRent * 52) / price) * 100 : 0;
  return {
    loan,
    monthlyRepayment,
    weeklyRepayment,
    monthlyRentEquiv,
    monthlyCashflow,
    annualCashflow,
    grossYieldPct
  };
}

function formatAud(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

function formatAudPlain(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function MortgageCalculatorPanel({ analysisText }) {
  const parsed = useMemo(
    () => ({
      price: extractPurchasePriceFromText(analysisText),
      rent: extractWeeklyRentFromText(analysisText)
    }),
    [analysisText]
  );

  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(650000);
  const [depositPct, setDepositPct] = useState(20);
  const [ratePct, setRatePct] = useState(6.5);
  const [termYears, setTermYears] = useState(30);
  const [repaymentMode, setRepaymentMode] = useState("pi");
  const [weeklyRent, setWeeklyRent] = useState(600);

  useEffect(() => {
    if (parsed.price != null) setPrice(Math.round(parsed.price));
    if (parsed.rent != null) setWeeklyRent(Math.round(parsed.rent));
  }, [parsed.price, parsed.rent]);

  const out = useMemo(
    () => computeMortgageOutputs(price, depositPct, ratePct, termYears, repaymentMode, weeklyRent),
    [price, depositPct, ratePct, termYears, repaymentMode, weeklyRent]
  );

  const inp = {
    background: "#181c24",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "8px 10px",
    color: "#e8e6e0",
    fontFamily: "'IBM Plex Mono',monospace",
    fontSize: 13,
    width: "100%"
  };
  const lab = { fontSize: 10, color: "#6b7280", marginBottom: 4, letterSpacing: "0.04em", textTransform: "uppercase" };
  const row = { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 };
  const cell = { flex: "1 1 140px", minWidth: 120 };

  return (
    <div style={{ padding: "0 28px 12px", flexShrink: 0 }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid rgba(232,184,75,0.35)",
            background: "rgba(232,184,75,0.06)",
            color: "#e8b84b",
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Calculate Mortgage
        </button>
      ) : (
        <div
          style={{
            background: "#0e1117",
            border: "1px solid rgba(232,184,75,0.22)",
            borderRadius: 12,
            padding: 16,
            animation: "fu 0.25s ease both"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: "#e8e6e0" }}>
              Mortgage calculator
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                fontSize: 11,
                color: "#6b7280",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "'IBM Plex Mono',monospace"
              }}
            >
              Collapse
            </button>
          </div>

          <div style={row}>
            <div style={cell}>
              <div style={lab}>Purchase price</div>
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value) || 0)}
                style={inp}
              />
            </div>
            <div style={cell}>
              <div style={lab}>Deposit %</div>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={depositPct}
                onChange={(e) => setDepositPct(Number(e.target.value) || 0)}
                style={inp}
              />
            </div>
            <div style={cell}>
              <div style={lab}>Interest rate % p.a.</div>
              <input
                type="number"
                min={0}
                max={30}
                step={0.05}
                value={ratePct}
                onChange={(e) => setRatePct(Number(e.target.value) || 0)}
                style={inp}
              />
            </div>
          </div>

          <div style={row}>
            <div style={cell}>
              <div style={lab}>Loan term (years)</div>
              <input
                type="number"
                min={1}
                max={40}
                value={termYears}
                onChange={(e) => setTermYears(Number(e.target.value) || 30)}
                style={inp}
              />
            </div>
            <div style={{ ...cell, flex: "1 1 200px" }}>
              <div style={lab}>Repayment</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setRepaymentMode("pi")}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${repaymentMode === "pi" ? "#e8b84b" : "rgba(255,255,255,0.1)"}`,
                    background: repaymentMode === "pi" ? "rgba(232,184,75,0.12)" : "#181c24",
                    color: "#e8e6e0",
                    fontFamily: "'IBM Plex Mono',monospace",
                    fontSize: 11,
                    cursor: "pointer"
                  }}
                >
                  P&amp;I
                </button>
                <button
                  type="button"
                  onClick={() => setRepaymentMode("io")}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${repaymentMode === "io" ? "#e8b84b" : "rgba(255,255,255,0.1)"}`,
                    background: repaymentMode === "io" ? "rgba(232,184,75,0.12)" : "#181c24",
                    color: "#e8e6e0",
                    fontFamily: "'IBM Plex Mono',monospace",
                    fontSize: 11,
                    cursor: "pointer"
                  }}
                >
                  Interest only
                </button>
              </div>
            </div>
            <div style={cell}>
              <div style={lab}>Weekly rent</div>
              <input
                type="number"
                min={0}
                value={weeklyRent}
                onChange={(e) => setWeeklyRent(Number(e.target.value) || 0)}
                style={inp}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: 4,
              paddingTop: 14,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 10,
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 12
            }}
          >
            {[
              ["Loan amount", formatAud(out.loan)],
              ["Monthly repayment", formatAud(out.monthlyRepayment)],
              ["Weekly repayment", formatAud(out.weeklyRepayment)],
              ["Weekly rent", formatAud(weeklyRent)],
              ["Rent vs weekly repayment", `${formatAudPlain(weeklyRent)} vs ${formatAudPlain(out.weeklyRepayment)}`],
              [
                "Monthly cashflow",
                <span key="mcf" style={{ color: out.monthlyCashflow >= 0 ? "#4ade80" : "#f87171" }}>
                  {out.monthlyCashflow >= 0 ? "+" : ""}
                  {formatAud(out.monthlyCashflow)}
                </span>
              ],
              ["Gross yield", `${out.grossYieldPct.toFixed(2)}%`],
              [
                "Annual cashflow",
                <span key="acf" style={{ color: out.annualCashflow >= 0 ? "#4ade80" : "#f87171" }}>
                  {out.annualCashflow >= 0 ? "+" : ""}
                  {formatAud(out.annualCashflow)}
                </span>
              ]
            ].map(([k, v], i) => (
              <div
                key={i}
                style={{
                  background: "#181c24",
                  borderRadius: 8,
                  padding: "10px 12px",
                  border: "1px solid rgba(255,255,255,0.06)"
                }}
              >
                <div style={{ fontSize: 9, color: "#4b5563", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</div>
                <div style={{ color: "#e8e6e0", fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: "#4b5563", lineHeight: 1.5 }}>
            Indicative only — not financial advice. Confirm repayments with your lender.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function Landing({ onStart }) {
  return (
    <div className="landing-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
        :root {
          --bg: #f5efe4; --bg-soft: #faf5ea; --bg-deep: #ebe3d3; --paper: #ffffff; --ink: #1a1a17;
          --ink-soft: #4a463e; --ink-faint: #8a8375; --green: #0f3f2e; --green-deep: #072016;
          --green-soft: #1a5a43; --orange: #d85a2e; --orange-deep: #b84820; --orange-soft: #ef7d52;
          --yellow: #f5c842; --mint: #16a34a; --red: #dc2626; --line: #e4dcca; --line-deep: #1a1a17;
          --r-sm: 8px; --r: 12px; --r-lg: 16px; --r-xl: 24px;
        }
        .landing-page * { margin: 0; padding: 0; box-sizing: border-box; }
        .landing-page { background: var(--bg); color: var(--ink); font-family: 'Manrope', -apple-system, sans-serif; line-height: 1.55; position: relative; min-height: 100vh; }
        .landing-page::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: 0.028; z-index: 9999; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .landing-page .container { max-width: 1280px; margin: 0 auto; padding: 0 32px; }
        .landing-page nav { padding: 22px 0; background: rgba(245, 239, 228, 0.9); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 100; border-bottom: 1px solid var(--line); }
        .landing-page nav .container { display: flex; align-items: center; justify-content: space-between; }
        .landing-page .logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); }
        .landing-page .logo-mark { width: 28px; height: 28px; background: var(--green); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: var(--bg); font-family: 'Instrument Serif', serif; font-style: italic; font-size: 18px; position: relative; top: -1px; }
        .landing-page .logo-text { font-size: 20px; font-weight: 800; letter-spacing: -0.04em; }
        .landing-page .logo-text .ai { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; color: var(--orange); margin-left: 1px; }
        .landing-page .nav-links { display: flex; gap: 32px; align-items: center; }
        .landing-page .nav-links a { color: var(--ink-soft); text-decoration: none; font-size: 14px; font-weight: 500; letter-spacing: -0.01em; transition: color 0.15s; }
        .landing-page .nav-links a:hover { color: var(--ink); }
        .landing-page .btn { display: inline-flex; align-items: center; gap: 6px; padding: 11px 20px; background: var(--ink); color: var(--bg); font-weight: 600; font-size: 14px; text-decoration: none; border: 1px solid var(--ink); border-radius: var(--r); cursor: pointer; transition: all 0.2s ease; letter-spacing: -0.01em; white-space: nowrap; }
        .landing-page .btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px -6px rgba(26, 26, 23, 0.25); }
        .landing-page .btn-accent { background: var(--orange); border-color: var(--orange); color: var(--paper); }
        .landing-page .btn-accent:hover { background: var(--orange-deep); border-color: var(--orange-deep); box-shadow: 0 8px 24px -6px rgba(216, 90, 46, 0.4); }
        .landing-page .btn-ghost { background: transparent; color: var(--ink); border: 1px solid var(--ink); }
        .landing-page .btn-ghost:hover { background: var(--ink); color: var(--bg); }
        .landing-page .btn-lg { padding: 16px 28px; font-size: 15px; border-radius: var(--r); }
        .landing-page .hero { padding: 100px 0 120px; position: relative; text-align: center; }
        .landing-page .hero-pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 100px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-soft); margin-bottom: 32px; }
        .landing-page .hero-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--mint); animation: pulse 2s infinite; box-shadow: 0 0 10px rgba(22, 163, 74, 0.5); }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.85); } }
        .landing-page h1.hero-headline { font-weight: 800; font-size: clamp(52px, 8vw, 112px); line-height: 0.95; letter-spacing: -0.045em; max-width: 1100px; margin: 0 auto 32px; }
        .landing-page h1.hero-headline .accent { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 500; color: var(--green); letter-spacing: -0.02em; }
        .landing-page h1.hero-headline .underline { position: relative; display: inline-block; }
        .landing-page h1.hero-headline .underline::after { content: ''; position: absolute; bottom: 8px; left: -4px; right: -4px; height: 14px; background: var(--yellow); z-index: -1; opacity: 0.55; }
        .landing-page .hero-sub { font-size: 20px; line-height: 1.5; color: var(--ink-soft); max-width: 640px; margin: 0 auto 40px; letter-spacing: -0.005em; }
        .landing-page .hero-sub strong { color: var(--ink); font-weight: 600; }
        .landing-page .hero-cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 18px; }
        .landing-page .hero-trust { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-faint); }
        .landing-page .hero-trust span { margin: 0 10px; color: var(--line); }
        .landing-page .hero-card-wrap { max-width: 1000px; margin: 80px auto 0; perspective: 1800px; }
        .landing-page .hero-card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: 0 40px 80px -40px rgba(15, 63, 46, 0.3), 0 20px 40px -20px rgba(26, 26, 23, 0.1); overflow: hidden; transform: rotateX(2deg); }
        .landing-page .hero-card-top { display: grid; grid-template-columns: 1fr auto; gap: 24px; padding: 20px 28px; border-bottom: 1px solid var(--line); align-items: center; background: var(--bg-soft); }
        .landing-page .hc-url { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-soft); display: flex; align-items: center; gap: 8px; }
        .landing-page .hc-url::before { content: ''; width: 8px; height: 8px; background: var(--mint); border-radius: 50%; animation: pulse 2s infinite; }
        .landing-page .hc-time { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-faint); }
        .landing-page .hero-card-body { padding: 40px 36px; display: grid; grid-template-columns: 1.4fr 1fr; gap: 48px; align-items: center; text-align: left; }
        .landing-page .hc-address { font-family: 'Instrument Serif', serif; font-size: 34px; line-height: 1.05; letter-spacing: -0.02em; margin-bottom: 8px; color: var(--ink); }
        .landing-page .hc-specs { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-faint); margin-bottom: 28px; }
        .landing-page .hc-metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; padding-top: 24px; border-top: 1px solid var(--line); }
        .landing-page .hc-metric .label { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-faint); text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.04em; }
        .landing-page .hc-metric .value { font-weight: 700; font-size: 22px; letter-spacing: -0.03em; }
        .landing-page .hc-metric .value.pos { color: var(--mint); }
        .landing-page .hc-metric .value.warn { color: var(--orange); }
        .landing-page .hc-verdict-side { background: var(--green); color: var(--paper); padding: 32px; text-align: center; border-radius: var(--r); position: relative; overflow: hidden; }
        .landing-page .hc-verdict-side::before { content: '§ LIVE'; position: absolute; top: 12px; right: 14px; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; color: var(--yellow); opacity: 0.7; }
        .landing-page .hc-score { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 84px; line-height: 1; letter-spacing: -0.04em; color: var(--yellow); margin-bottom: 0; }
        .landing-page .hc-score .denom { font-size: 28px; color: rgba(255, 255, 255, 0.5); font-style: normal; }
        .landing-page .hc-score-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(255, 255, 255, 0.55); text-transform: uppercase; letter-spacing: 0.12em; margin: 4px 0 18px; }
        .landing-page .hc-verdict-badge { display: inline-block; padding: 10px 22px; background: var(--orange); color: var(--paper); font-weight: 700; font-size: 13px; letter-spacing: 0.08em; border-radius: var(--r-sm); margin-bottom: 20px; }
        .landing-page .hc-walkaway { padding-top: 18px; border-top: 1px solid rgba(255, 255, 255, 0.15); font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255, 255, 255, 0.55); text-transform: uppercase; letter-spacing: 0.1em; }
        .landing-page .hc-walkaway .price { display: block; font-weight: 700; font-size: 22px; color: var(--paper); margin-top: 4px; letter-spacing: -0.02em; text-transform: none; }
        .landing-page .trust { padding: 56px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--bg-soft); }
        .landing-page .trust-label { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 24px; }
        .landing-page .trust-grid { display: flex; justify-content: space-around; align-items: center; flex-wrap: wrap; gap: 48px; font-family: 'Instrument Serif', serif; font-style: italic; font-size: 22px; color: var(--ink-soft); opacity: 0.75; }
        .landing-page section { padding: 120px 0; position: relative; }
        .landing-page .section-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--orange); letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 20px; font-weight: 500; }
        .landing-page .section-eyebrow::before { content: ''; width: 24px; height: 1px; background: var(--orange); }
        .landing-page h2.section-headline { font-weight: 800; font-size: clamp(40px, 5.5vw, 72px); line-height: 0.98; letter-spacing: -0.04em; margin-bottom: 24px; max-width: 900px; }
        .landing-page h2.section-headline .accent { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 500; color: var(--green); letter-spacing: -0.02em; }
        .landing-page .section-sub { font-size: 18px; line-height: 1.55; color: var(--ink-soft); max-width: 600px; margin-bottom: 56px; letter-spacing: -0.005em; }
        .landing-page .why-grid, .landing-page .features-grid, .landing-page .proof-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 48px; }
        .landing-page .why-card, .landing-page .feature, .landing-page .proof-card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-lg); }
        .landing-page .why-card { padding: 40px 36px; transition: all 0.25s ease; }
        .landing-page .why-card:hover, .landing-page .feature:hover { transform: translateY(-4px); box-shadow: 0 24px 48px -24px rgba(26, 26, 23, 0.15); border-color: var(--green); }
        .landing-page .why-num { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 44px; line-height: 1; color: var(--green); margin-bottom: 20px; }
        .landing-page .why-title { font-weight: 700; font-size: 22px; line-height: 1.2; letter-spacing: -0.025em; margin-bottom: 12px; }
        .landing-page .why-body { font-size: 15px; line-height: 1.55; color: var(--ink-soft); letter-spacing: -0.005em; }
        .landing-page .demo { background: var(--bg-soft); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
        .landing-page .verdict-doc { max-width: 1080px; margin: 0 auto; background: var(--paper); border: 1.5px solid var(--line-deep); box-shadow: 12px 12px 0 var(--green-deep); }
        .landing-page .vd-header { background: var(--ink); color: var(--paper); padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; }
        .landing-page .vd-header .status { color: var(--yellow); display: inline-flex; align-items: center; gap: 8px; }
        .landing-page .vd-header .status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--mint); animation: pulse 2s infinite; box-shadow: 0 0 8px rgba(22, 163, 74, 0.6); }
        .landing-page .vd-body { padding: 48px 40px; }
        .landing-page .vd-top { display: grid; grid-template-columns: 1fr auto; padding-bottom: 36px; border-bottom: 1.5px solid var(--line-deep); gap: 40px; align-items: center; }
        .landing-page .vd-address { font-family: 'Instrument Serif', serif; font-size: 44px; line-height: 1.05; letter-spacing: -0.02em; color: var(--ink); margin-bottom: 10px; }
        .landing-page .vd-specs { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-faint); letter-spacing: 0.04em; text-transform: uppercase; }
        .landing-page .vd-score-block { text-align: right; padding-left: 40px; border-left: 1.5px solid var(--line-deep); display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
        .landing-page .vd-score { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 92px; line-height: 0.9; letter-spacing: -0.04em; color: var(--green); }
        .landing-page .vd-score .denom { color: var(--ink-faint); font-style: normal; font-size: 40px; }
        .landing-page .vd-score-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.14em; }
        .landing-page .vd-badge { display: inline-block; padding: 10px 20px; background: var(--orange); color: var(--paper); font-weight: 700; font-size: 14px; letter-spacing: 0.1em; border-radius: 0; }
        .landing-page .vd-metrics { display: grid; grid-template-columns: repeat(4, 1fr); padding: 32px 0; border-bottom: 1.5px solid var(--line-deep); margin-bottom: 32px; }
        .landing-page .vd-metric { padding: 0 24px; border-right: 1px dashed var(--ink-faint); }
        .landing-page .vd-metric:last-child { border-right: none; }
        .landing-page .vd-metric:first-child { padding-left: 0; }
        .landing-page .vd-metric-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-faint); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 10px; }
        .landing-page .vd-metric-value { font-weight: 800; font-size: 32px; letter-spacing: -0.035em; }
        .landing-page .vd-metric-value.pos { color: var(--mint); }
        .landing-page .vd-metric-sub { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-faint); margin-top: 4px; }
        .landing-page .vd-flags { background: rgba(216, 90, 46, 0.06); border-left: 4px solid var(--orange); padding: 22px 28px; margin-bottom: 32px; }
        .landing-page .vd-flags h4 { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 11px; color: var(--orange-deep); letter-spacing: 0.14em; margin-bottom: 14px; text-transform: uppercase; }
        .landing-page .vd-flags ul { list-style: none; display: grid; gap: 8px; }
        .landing-page .vd-flags li { font-size: 14px; color: var(--ink); padding-left: 24px; position: relative; line-height: 1.5; }
        .landing-page .vd-flags li::before { content: '→'; position: absolute; left: 0; color: var(--orange); font-family: 'JetBrains Mono', monospace; font-weight: 700; }
        .landing-page .vd-move { display: grid; grid-template-columns: repeat(3, 1fr); border: 1.5px solid var(--line-deep); }
        .landing-page .vd-move-cell { padding: 24px 28px; border-right: 1.5px solid var(--line-deep); background: var(--paper); }
        .landing-page .vd-move-cell:last-child { border-right: none; }
        .landing-page .vd-move-cell:nth-child(2) { background: var(--green); color: var(--paper); }
        .landing-page .vd-move-cell:nth-child(3) { background: var(--ink); color: var(--paper); }
        .landing-page .vd-move-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 10px; opacity: 0.7; }
        .landing-page .vd-move-value { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 36px; line-height: 1; letter-spacing: -0.03em; }
        .landing-page .vd-move-cell:nth-child(2) .vd-move-value, .landing-page .vd-move-cell:nth-child(3) .vd-move-value { color: var(--yellow); }
        .landing-page .vd-move-value.sm { font-family: 'Manrope', sans-serif; font-style: normal; font-size: 14px; line-height: 1.4; font-weight: 500; letter-spacing: -0.01em; }
        .landing-page .feature { padding: 36px; transition: all 0.2s; }
        .landing-page .feature-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        .landing-page .feature-icon { width: 48px; height: 48px; background: var(--bg-deep); border-radius: var(--r); display: inline-flex; align-items: center; justify-content: center; font-size: 22px; }
        .landing-page .feature-code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-faint); letter-spacing: 0.08em; }
        .landing-page .feature h3 { font-weight: 700; font-size: 22px; letter-spacing: -0.025em; margin-bottom: 10px; line-height: 1.2; }
        .landing-page .feature h3 .serif { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 500; color: var(--green); }
        .landing-page .feature p { font-size: 15px; line-height: 1.55; color: var(--ink-soft); letter-spacing: -0.005em; }
        .landing-page .compare { background: var(--green); color: var(--paper); }
        .landing-page .compare .section-eyebrow { color: var(--yellow); }
        .landing-page .compare .section-eyebrow::before { background: var(--yellow); }
        .landing-page .compare h2 { color: var(--paper); }
        .landing-page .compare h2 .accent { color: var(--yellow); }
        .landing-page .compare .section-sub { color: rgba(250, 245, 234, 0.75); }
        .landing-page .compare-table { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.15); margin-top: 40px; }
        .landing-page .compare-head, .landing-page .compare-row { display: grid; grid-template-columns: 2.2fr 1fr 1fr; }
        .landing-page .compare-head { background: rgba(0, 0, 0, 0.2); }
        .landing-page .compare-head > div { padding: 22px 28px; font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(250, 245, 234, 0.7); border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        .landing-page .compare-head .us { background: var(--yellow); color: var(--ink); }
        .landing-page .compare-row { border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
        .landing-page .compare-row:last-child { border-bottom: none; }
        .landing-page .compare-row > div { padding: 22px 28px; font-size: 15px; display: flex; align-items: center; letter-spacing: -0.005em; }
        .landing-page .compare-row .us { background: rgba(245, 200, 66, 0.1); justify-content: center; color: var(--yellow); font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 20px; }
        .landing-page .compare-row .them { justify-content: center; color: rgba(250, 245, 234, 0.4); font-family: 'JetBrains Mono', monospace; font-size: 18px; }
        .landing-page .compare-cta { margin-top: 40px; background: var(--yellow); color: var(--ink); padding: 32px; text-align: center; font-family: 'Instrument Serif', serif; font-style: italic; font-size: 26px; letter-spacing: -0.01em; }
        .landing-page .compare-cta strong { font-style: normal; font-weight: 700; }
        .landing-page .proof-card { padding: 32px; }
        .landing-page .proof-quote-mark { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 56px; line-height: 0.4; color: var(--orange); margin-bottom: 12px; display: block; }
        .landing-page .proof-quote { font-family: 'Instrument Serif', serif; font-size: 20px; line-height: 1.35; margin-bottom: 24px; letter-spacing: -0.01em; color: var(--ink); }
        .landing-page .proof-author { display: flex; align-items: center; gap: 12px; padding-top: 20px; border-top: 1px solid var(--line); }
        .landing-page .proof-avatar { width: 44px; height: 44px; border-radius: 50%; background: var(--green); color: var(--paper); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; letter-spacing: 0.02em; }
        .landing-page .proof-name { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
        .landing-page .proof-role { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-faint); margin-top: 2px; letter-spacing: 0.02em; }
        .landing-page .pricing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 960px; margin: 56px auto 0; }
        .landing-page .price-card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-xl); padding: 48px 40px; position: relative; transition: transform 0.2s; }
        .landing-page .price-card.pro { background: var(--ink); color: var(--paper); border-color: var(--ink); box-shadow: 0 40px 80px -30px rgba(216, 90, 46, 0.35); }
        .landing-page .price-card.pro::before { content: 'RECOMMENDED'; position: absolute; top: 24px; right: 32px; background: var(--orange); color: var(--paper); padding: 5px 12px; border-radius: var(--r-sm); font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; font-weight: 700; }
        .landing-page .price-tier { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 22px; color: var(--ink-soft); margin-bottom: 20px; }
        .landing-page .price-card.pro .price-tier { color: rgba(245, 239, 228, 0.7); }
        .landing-page .price-amount { font-weight: 800; font-size: 72px; line-height: 1; letter-spacing: -0.05em; }
        .landing-page .price-card.pro .price-amount { color: var(--yellow); }
        .landing-page .price-period { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-faint); margin-top: 8px; margin-bottom: 32px; letter-spacing: 0.02em; }
        .landing-page .price-card.pro .price-period { color: rgba(245, 239, 228, 0.55); }
        .landing-page .price-features { list-style: none; margin-bottom: 32px; }
        .landing-page .price-features li { padding: 11px 0; font-size: 15px; display: flex; gap: 12px; align-items: center; border-bottom: 1px solid var(--line); letter-spacing: -0.005em; }
        .landing-page .price-card.pro .price-features li { border-bottom-color: rgba(255, 255, 255, 0.08); }
        .landing-page .price-features li::before { content: '✓'; color: var(--mint); font-weight: 700; font-size: 14px; }
        .landing-page .price-features li.no::before { content: '—'; color: var(--ink-faint); }
        .landing-page .price-features li.no { color: var(--ink-faint); }
        .landing-page .price-card .btn { width: 100%; justify-content: center; padding: 16px; border-radius: var(--r); }
        .landing-page .price-card.pro .btn { background: var(--orange); border-color: var(--orange); color: var(--paper); }
        .landing-page .price-card.pro .btn:hover { background: var(--orange-deep); border-color: var(--orange-deep); }
        .landing-page .pricing-note { text-align: center; margin-top: 48px; font-family: 'Instrument Serif', serif; font-style: italic; font-size: 24px; color: var(--ink-soft); letter-spacing: -0.01em; }
        .landing-page .final { background: var(--orange); color: var(--paper); text-align: center; padding: 160px 0; position: relative; overflow: hidden; }
        .landing-page .final::before { content: ''; position: absolute; inset: 0; background-image: repeating-linear-gradient(45deg, transparent 0, transparent 60px, rgba(255, 255, 255, 0.03) 60px, rgba(255, 255, 255, 0.03) 61px); }
        .landing-page .final > .container { position: relative; z-index: 2; }
        .landing-page .final h2 { font-weight: 800; font-size: clamp(52px, 8vw, 112px); line-height: 0.95; letter-spacing: -0.04em; margin-bottom: 28px; color: var(--paper); }
        .landing-page .final h2 .accent { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 500; color: var(--yellow); }
        .landing-page .final p { font-size: 20px; margin-bottom: 40px; color: rgba(255, 255, 255, 0.85); letter-spacing: -0.005em; }
        .landing-page .final .btn { background: var(--ink); color: var(--paper); border-color: var(--ink); padding: 22px 40px; font-size: 16px; }
        .landing-page footer { background: var(--ink); color: var(--bg); padding: 60px 0 32px; }
        .landing-page .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; padding-bottom: 40px; border-bottom: 1px solid rgba(245, 239, 228, 0.15); }
        .landing-page .footer-brand .logo-text { color: var(--bg); }
        .landing-page .footer-brand p { margin-top: 16px; font-size: 14px; color: rgba(245, 239, 228, 0.6); max-width: 300px; line-height: 1.6; }
        .landing-page .footer-col h5 { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--yellow); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 18px; }
        .landing-page .footer-col ul { list-style: none; }
        .landing-page .footer-col li { margin-bottom: 10px; }
        .landing-page .footer-col a { color: rgba(245, 239, 228, 0.75); text-decoration: none; font-size: 14px; transition: color 0.15s; }
        .landing-page .footer-col a:hover { color: var(--orange); }
        .landing-page .footer-bottom { padding-top: 28px; display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.06em; color: rgba(245, 239, 228, 0.5); text-transform: uppercase; }
        @media (max-width: 900px) {
          .landing-page .container { padding: 0 20px; }
          .landing-page .hero { padding: 60px 0 80px; }
          .landing-page section { padding: 80px 0; }
          .landing-page .nav-links:not(.nav-cta) { display: none; }
          .landing-page .nav-links.nav-cta { display: flex !important; }
          .landing-page .why-grid, .landing-page .features-grid, .landing-page .proof-grid, .landing-page .pricing-grid, .landing-page .footer-grid { grid-template-columns: 1fr; }
          .landing-page .vd-metrics { grid-template-columns: repeat(2, 1fr); gap: 20px; }
          .landing-page .vd-metric { border-right: none; padding: 12px; border-bottom: 1px dashed var(--ink-faint); }
          .landing-page .hero-card-body { grid-template-columns: 1fr; text-align: left; gap: 24px; padding: 28px; }
          .landing-page .vd-body { padding: 28px 24px; }
          .landing-page .vd-top { grid-template-columns: 1fr; gap: 24px; }
          .landing-page .vd-score-block { border-left: none; padding-left: 0; align-items: flex-start; text-align: left; }
          .landing-page .vd-score { font-size: 60px; }
          .landing-page .vd-address { font-size: 30px; }
          .landing-page .vd-move { grid-template-columns: 1fr; }
          .landing-page .vd-move-cell { border-right: none; border-bottom: 1.5px solid var(--line-deep); }
          .landing-page .vd-move-cell:last-child { border-bottom: none; }
          .landing-page .compare-head > div, .landing-page .compare-row > div { padding: 14px; font-size: 13px; }
          .landing-page .footer-bottom { flex-direction: column; gap: 10px; }
        }
      `}</style>

      <nav>
        <div className="container">
          <a href="#" className="logo">
            <span className="logo-mark">P</span>
            <span className="logo-text">Prop<span className="ai">AI</span></span>
          </a>
          <div className="nav-links">
            <a href="#why">Why</a>
            <a href="#demo">Live demo</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <button className="btn btn-accent" onClick={onStart}>Try Free →</button>
          </div>
          <div className="nav-links nav-cta" style={{ display: "none" }}>
            <button className="btn btn-accent" onClick={onStart}>Try Free →</button>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="container">
          <div className="hero-pill"><span className="dot"></span><span>Live across 12,340 Australian suburbs</span></div>
          <h1 className="hero-headline">Your next investment property,<br /><span className="accent">decided</span> in <span className="underline">30 seconds.</span></h1>
          <p className="hero-sub">Paste a listing. Get a verdict — <strong>BUY, NEGOTIATE, or SKIP</strong> — with cashflow, yield, red flags, and your walk-away price. Built for rentvestors.</p>
          <div className="hero-cta-row">
            <button className="btn btn-accent btn-lg" onClick={onStart}>Analyse a Property →</button>
            <a href="#demo" className="btn btn-ghost btn-lg">See a live example</a>
          </div>
          <p className="hero-trust">No credit card<span>·</span>3 free verdicts<span>·</span>Cancel anytime</p>
          <div className="hero-card-wrap">
            <div className="hero-card">
              <div className="hero-card-top">
                <div className="hc-url">realestate.com.au/property/123-sample-st-mackay-qld</div>
                <div className="hc-time">Analysed 0:28 ago</div>
              </div>
              <div className="hero-card-body">
                <div>
                  <div className="hc-address">123 Sample Street, Mackay QLD</div>
                  <div className="hc-specs">$595,000 · 3 bed · 2 bath · 2 car · 12 days on market</div>
                  <div className="hc-metric-grid">
                    <div className="hc-metric"><div className="label">Weekly cashflow</div><div className="value pos">+$57</div></div>
                    <div className="hc-metric"><div className="label">Gross yield</div><div className="value">4.5%</div></div>
                    <div className="hc-metric"><div className="label">12mo growth</div><div className="value pos">+22%</div></div>
                    <div className="hc-metric"><div className="label">Red flags</div><div className="value warn">3</div></div>
                  </div>
                </div>
                <div className="hc-verdict-side">
                  <div className="hc-score">7.8<span className="denom">/10</span></div>
                  <div className="hc-score-label">Strategy Fit</div>
                  <div className="hc-verdict-badge">NEGOTIATE</div>
                  <div className="hc-walkaway">Walk-away price<span className="price">$572,000</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="trust">
        <div className="container">
          <div className="trust-label">Live data sourced from</div>
          <div className="trust-grid"><span>CoreLogic</span><span>Domain</span><span>realestate.com.au</span><span>SQM Research</span><span>ABS</span></div>
        </div>
      </div>

      <section id="why">
        <div className="container">
          <div className="section-eyebrow">§ 01 — The positioning</div>
          <h2 className="section-headline">Built for rentvestors. Not <span className="accent">boomers with buyer&apos;s agents.</span></h2>
          <p className="section-sub">You rent where you want to live and invest where the yields are. That decision deserves better than "this suburb grew 8% last year."</p>
          <div className="why-grid">
            <div className="why-card"><div className="why-num">I.</div><div className="why-title">Speed that matches the market</div><div className="why-body">Good rentvesting opportunities move in days, not months. 30 seconds to a verdict means you act before the other buyer&apos;s agent does.</div></div>
            <div className="why-card"><div className="why-num">II.</div><div className="why-title">Honesty big platforms can&apos;t offer</div><div className="why-body">Domain and realestate.com.au are paid by agents. We&apos;re not. That&apos;s why we&apos;ll tell you when a suburb is already priced out.</div></div>
            <div className="why-card"><div className="why-num">III.</div><div className="why-title">Built around your strategy</div><div className="why-body">Your borrowing capacity. Your cashflow tolerance. Your 2030 goal. Every verdict is personalised to you — not generic investor advice.</div></div>
          </div>
        </div>
      </section>

      <section className="demo" id="demo">
        <div className="container">
          <div className="section-eyebrow">§ 02 — Live verdict</div>
          <h2 className="section-headline">This is what you get — <span className="accent">every time.</span></h2>
          <p className="section-sub">One property. One page. One decision. No 20-tab research sessions, no spreadsheets, no expensive reports.</p>
          <div className="verdict-doc">
            <div className="vd-header"><span>ANALYSIS · MKY-QLD-20260418-0832</span><span className="status">LIVE</span></div>
            <div className="vd-body">
              <div className="vd-top">
                <div><div className="vd-address">123 Sample Street,<br />Mackay QLD 4740</div><div className="vd-specs">$595,000 · 3 bed / 2 bath / 2 car · 12 days on market</div></div>
                <div className="vd-score-block"><div className="vd-score">7.8<span className="denom">/10</span></div><div className="vd-score-label">Strategy Fit Score</div><div className="vd-badge">NEGOTIATE</div></div>
              </div>
              <div className="vd-metrics">
                <div className="vd-metric"><div className="vd-metric-label">Weekly P&amp;L</div><div className="vd-metric-value pos">+$57</div><div className="vd-metric-sub">at $585k purchase</div></div>
                <div className="vd-metric"><div className="vd-metric-label">Gross yield</div><div className="vd-metric-value">4.5%</div><div className="vd-metric-sub">$520/wk rent</div></div>
                <div className="vd-metric"><div className="vd-metric-label">12mo growth</div><div className="vd-metric-value pos">+22%</div><div className="vd-metric-sub">vacancy 0.9%</div></div>
                <div className="vd-metric"><div className="vd-metric-label">Break-even</div><div className="vd-metric-value">4.7%</div><div className="vd-metric-sub">interest rate</div></div>
              </div>
              <div className="vd-flags"><h4>3 red flags detected</h4><ul><li>Priced 3% above 8 comparable sales (last 90 days)</li><li>Body corp $2,400/yr — eats 9% of gross rent</li><li>Partial flood overlay — check LPI report before offer</li></ul></div>
              <div className="vd-move">
                <div className="vd-move-cell"><div className="vd-move-label">Walk-away price</div><div className="vd-move-value" style={{ color: "var(--green)" }}>$572k</div></div>
                <div className="vd-move-cell"><div className="vd-move-label">Opening offer</div><div className="vd-move-value">$555k</div></div>
                <div className="vd-move-cell"><div className="vd-move-label">Rationale</div><div className="vd-move-value sm">Comparable sales gap + body corp adjustment</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features">
        <div className="container">
          <div className="section-eyebrow">§ 03 — The system</div>
          <h2 className="section-headline">Everything a rentvestor checks<br />before making an offer — <span className="accent">automated.</span></h2>
          <p className="section-sub">Six pre-offer checks, delivered in one clean view. Nothing else to open.</p>
          <div className="features-grid">
            <div className="feature"><div className="feature-top"><span className="feature-icon">⚖️</span><span className="feature-code">Ft. 01</span></div><h3>The <span className="serif">Verdict</span></h3><p>BUY, NEGOTIATE, or SKIP — with the reasons. No 20-page report. Just a call you can act on.</p></div>
            <div className="feature"><div className="feature-top"><span className="feature-icon">💰</span><span className="feature-code">Ft. 02</span></div><h3>Cashflow <span className="serif">Reality</span></h3><p>Weekly +/- at current interest rates. Not the dream numbers agents want you to see.</p></div>
            <div className="feature"><div className="feature-top"><span className="feature-icon">🚩</span><span className="feature-code">Ft. 03</span></div><h3>Rentvestor <span className="serif">Red Flags</span></h3><p>Flood zones, body corp horrors, oversupply, LMI thresholds, land tax traps — auto-scanned.</p></div>
            <div className="feature"><div className="feature-top"><span className="feature-icon">📊</span><span className="feature-code">Ft. 04</span></div><h3>Comparable <span className="serif">Sales</span></h3><p>This property vs 8 real recent sales. Walk-away price plus 3 negotiation angles.</p></div>
            <div className="feature"><div className="feature-top"><span className="feature-icon">🎯</span><span className="feature-code">Ft. 05</span></div><h3>Strategy <span className="serif">Fit Score</span></h3><p>Does this property fit YOUR rentvesting plan? Personalised to capacity, cashflow, goals.</p></div>
            <div className="feature"><div className="feature-top"><span className="feature-icon">🔥</span><span className="feature-code">Ft. 06</span></div><h3>Daily <span className="serif">Deal Radar</span></h3><p>Top 5 undervalued properties in your target suburbs. One AVOID warning every morning.</p></div>
          </div>
        </div>
      </section>

      <section className="compare">
        <div className="container">
          <div className="section-eyebrow">§ 04 — The difference</div>
          <h2 className="section-headline">Why not just use <span className="accent">Domain?</span></h2>
          <p className="section-sub">The big platforms are great for browsing. Terrible for deciding. Here&apos;s what they won&apos;t tell you — and what we will.</p>
          <div className="compare-table">
            <div className="compare-head"><div>What you need</div><div className="us">PropAI</div><div>Domain / realestate.com.au</div></div>
            <div className="compare-row"><div>Tells you if this property is a good deal</div><div className="us">✓</div><div className="them">—</div></div>
            <div className="compare-row"><div>Flags red flags agents won&apos;t mention</div><div className="us">✓</div><div className="them">—</div></div>
            <div className="compare-row"><div>Calculates your cashflow at real interest rates</div><div className="us">✓</div><div className="them">—</div></div>
            <div className="compare-row"><div>Gives you a walk-away price</div><div className="us">✓</div><div className="them">—</div></div>
            <div className="compare-row"><div>Personalised to your rentvesting strategy</div><div className="us">✓</div><div className="them">—</div></div>
            <div className="compare-row"><div>Funded by real estate agents</div><div className="us">—</div><div className="them" style={{ color: "var(--yellow)" }}>✓</div></div>
          </div>
          <div className="compare-cta">We&apos;re not funded by agents. <strong>That&apos;s the whole point.</strong></div>
        </div>
      </section>

      <section>
        <div className="container">
          <div className="section-eyebrow">§ 05 — The users</div>
          <h2 className="section-headline">Built by rentvestors, <span className="accent">for rentvestors.</span></h2>
          <div className="proof-grid">
            <div className="proof-card"><span className="proof-quote-mark">"</span><div className="proof-quote">Saved me from a $40k mistake on a flood-zone property in Townsville. Paid for itself on first use.</div><div className="proof-author"><div className="proof-avatar">CH</div><div><div className="proof-name">Cam H.</div><div className="proof-role">RENTVESTOR · SYDNEY</div></div></div></div>
            <div className="proof-card"><span className="proof-quote-mark">"</span><div className="proof-quote">I was ready to offer $610k. PropAI said walk away above $578k. Got it at $575k.</div><div className="proof-author"><div className="proof-avatar">SK</div><div><div className="proof-name">Sarah K.</div><div className="proof-role">RENTVESTOR · MELBOURNE</div></div></div></div>
            <div className="proof-card"><span className="proof-quote-mark">"</span><div className="proof-quote">Finally a tool that speaks rentvestor, not first-home buyer. The red flag scanner alone is worth $49.</div><div className="proof-author"><div className="proof-avatar">JT</div><div><div className="proof-name">James T.</div><div className="proof-role">RENTVESTOR · BRISBANE</div></div></div></div>
          </div>
        </div>
      </section>

      <section id="pricing">
        <div className="container" style={{ textAlign: "center" }}>
          <div className="section-eyebrow" style={{ margin: "0 auto 20px" }}>§ 06 — The pricing</div>
          <h2 className="section-headline" style={{ margin: "0 auto 24px" }}>Honest pricing. <span className="accent">No card to start.</span></h2>
          <p className="section-sub" style={{ margin: "0 auto" }}>Start free. Upgrade when one good deal makes the subscription a rounding error.</p>
          <div className="pricing-grid" style={{ textAlign: "left" }}>
            <div className="price-card">
              <div className="price-tier">Free Forever</div><div className="price-amount">$0</div><div className="price-period">forever · no card needed</div>
              <ul className="price-features"><li>3 full verdicts</li><li>Strategy fit score</li><li>Red flag scanner</li><li className="no">Daily Deal Radar</li><li className="no">Unlimited analyses</li></ul>
              <button className="btn btn-ghost" onClick={onStart}>Start Free</button>
            </div>
            <div className="price-card pro">
              <div className="price-tier">Pro</div><div className="price-amount">$49</div><div className="price-period">per month · cancel anytime</div>
              <ul className="price-features"><li>Unlimited verdicts</li><li>Daily Deal Radar</li><li>Strategy fit score</li><li>Red flag scanner</li><li>Negotiation scripts</li><li>Portfolio tracking</li></ul>
              <button className="btn" onClick={onStart}>Get Pro →</button>
            </div>
          </div>
          <p className="pricing-note">One good deal pays for ten years of Pro.</p>
        </div>
      </section>

      <section className="final" id="final">
        <div className="container">
          <h2>Your next offer shouldn&apos;t be a <span className="accent">guess.</span></h2>
          <p>Drop a listing URL. Get a verdict in 30 seconds. No signup required for your first one.</p>
          <button className="btn btn-lg" onClick={onStart}>Analyse a Property Now →</button>
        </div>
      </section>

      <footer>
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <a href="#" className="logo"><span className="logo-mark">P</span><span className="logo-text">Prop<span className="ai">AI</span></span></a>
              <p>Australian property intelligence, built for rentvestors. Live data, real decisions, zero agent funding.</p>
            </div>
            <div className="footer-col"><h5>Product</h5><ul><li><a href="#features">Features</a></li><li><a href="#pricing">Pricing</a></li><li><a href="#demo">Live demo</a></li></ul></div>
            <div className="footer-col"><h5>Company</h5><ul><li><a href="#">About</a></li><li><a href="#">Blog</a></li><li><a href="#">Contact</a></li></ul></div>
            <div className="footer-col"><h5>Legal</h5><ul><li><a href="#">Terms</a></li><li><a href="#">Privacy</a></li><li><a href="#">Disclaimer</a></li></ul></div>
          </div>
          <div className="footer-bottom"><div>© 2026 PropAI — Australian Property Intelligence</div><div>Not financial advice · Consult a broker + conveyancer</div></div>
        </div>
      </footer>
    </div>
  );
}

// ─── PAYWALL ──────────────────────────────────────────────────────────────────
function Paywall({ used, onUpgrade }) {
  return React.createElement("div", { style:{ background:"#111318", border:"1px solid rgba(232,184,75,0.3)", borderRadius:14, padding:"28px 24px", margin:"20px 0", textAlign:"center" } },
    React.createElement("div", { style:{ fontSize:28, marginBottom:12 } }, "🔒"),
    React.createElement("div", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:18, marginBottom:8 } }, "You've used your 3 free analyses"),
    React.createElement("div", { style:{ color:"#6b7280", fontSize:13, marginBottom:20, lineHeight:1.6 } },
      "Upgrade to Pro to unlock unlimited deal analysis,", React.createElement("br"),
      "daily deal feed, negotiation strategies and more."
    ),
    React.createElement("div", { style:{ background:"#181c24", borderRadius:10, padding:"16px 20px", marginBottom:20, textAlign:"left" } },
      ...["✓ Unlimited suburb + deal analysis", "✓ Daily Deal of the Day", "✓ Undervalued detection", "✓ Full negotiation strategy", "✓ Investor Edge insights"].map((f,i) =>
        React.createElement("div", { key:i, style:{ fontSize:12, color:"#e8e6e0", marginBottom:6 } }, f)
      )
    ),
    React.createElement("button", { onClick:onUpgrade, style:{ width:"100%", padding:14, borderRadius:10, border:"none", background:"#e8b84b", color:"#000", fontFamily:"monospace", fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:10 } }, "Upgrade to Pro — $49/month →"),
    React.createElement("div", { style:{ fontSize:11, color:"#4b5563" } }, "Cancel anytime • Instant access")
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | app
  const [isPro, setIsPro] = useState(false);
  const [usageCount, setUsageCount] = useState(0);
  const [msgs, setMsgs] = useState([{
    role:"assistant",
    text:"G'day! I'm PropAI — your elite AI buyer's agent. 🏡\n\n**Three modes:**\n\n**🔥 DAILY DEALS** — Today's top scored opportunities\n**🏡 SUBURB MODE** — Full score breakdown + BUY/WATCH/AVOID\n**🏠 DEAL MODE** — Paste any property for undervalued detection + negotiation strategy\n\n**Every analysis includes:**\n- Deal Score /100 with transparent breakdown\n- Cashflow snapshot at 20% deposit\n- Undervalued detection vs comparable sales\n- Negotiation strategy with target price\n- Investor Edge — what smart money sees\n- Final Call — decisive, personal, actionable\n\n**What is your budget and target area?**"
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, busy]);

  function handleStart() { setScreen("app"); }
  function handleUpgrade() {
    window.open("https://buy.stripe.com/28EdRb8NX7ErgxQ4zF8k800", "_blank");
    setTimeout(() => setIsPro(true), 2000); // temp unlock for MVP
  }

  async function sendMsg(text) {
    const msg = (text || input).trim().slice(0, 500);
    if (!msg || busy) return;
    if (!isPro && usageCount >= FREE_LIMIT) return;
    const history = [...msgs, { role:"user", text:msg }];
    setMsgs([...history, { role:"assistant", text:"" }]);
    setInput("");
    setBusy(true);
    setSearching(true);
    try {
      let streamedContent = "";
      let ndjsonError = false;

      const res = await fetch("/api/analyze", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ history, system: SYSTEM }),
      });

      if (!res.ok) {
        let errMsg = "⚠️ Something went wrong pulling live data. Try again in 10–20 seconds.";
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const j = await res.json();
            if (j?.error) errMsg = typeof j.error === "string" ? `⚠️ ${j.error}` : errMsg;
          }
        } catch { /* ignore */ }
        setSearching(false);
        setMsgs(p => {
          const n = [...p];
          n[n.length - 1] = { role:"assistant", text: errMsg };
          return n;
        });
        setBusy(false);
        return;
      }

      if (!res.body) {
        setSearching(false);
        setMsgs(p => {
          const n = [...p];
          n[n.length - 1] = { role:"assistant", text: "⚠️ No response stream." };
          return n;
        });
        setBusy(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let firstToken = false;
      let streamHalt = false;

      const applyLine = (raw) => {
        if (streamHalt) return;
        const line = raw.trim();
        if (!line) return;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          return;
        }
        if (obj.error) {
          streamHalt = true;
          ndjsonError = true;
          streamedContent = obj.message || "⚠️ Error.";
          setSearching(false);
          setMsgs(p => {
            const n = [...p];
            n[n.length - 1] = { role:"assistant", text: streamedContent };
            return n;
          });
          return;
        }
        if (obj.compare && typeof obj.compare === "object") {
          setMsgs((p) => {
            const n = [...p];
            const last = n[n.length - 1];
            if (last?.role === "assistant") {
              n[n.length - 1] = { ...last, compareMeta: obj.compare };
            }
            return n;
          });
          return;
        }
        if (obj.fallback && obj.message) {
          streamedContent += obj.message;
          setSearching(false);
          setMsgs(p => {
            const n = [...p];
            const last = n[n.length - 1];
            if (last?.role === "assistant") {
              n[n.length - 1] = {
                ...last,
                text: (last.text || "") + obj.message,
                compareMeta: last.compareMeta
              };
            }
            return n;
          });
          return;
        }
        if (typeof obj.delta === "string" && obj.delta.length) {
          streamedContent += obj.delta;
          if (!firstToken) {
            firstToken = true;
            setSearching(false);
          }
          setMsgs(p => {
            const n = [...p];
            const last = n[n.length - 1];
            if (last?.role === "assistant") {
              n[n.length - 1] = {
                ...last,
                text: (last.text || "") + obj.delta,
                compareMeta: last.compareMeta
              };
            }
            return n;
          });
        }
        if (obj.done) setSearching(false);
      };

      while (!streamHalt) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          applyLine(line);
        }
      }
      if (!streamHalt) applyLine(buf);
      setSearching(false);

      if (!isPro && shouldCountFreeSuccessfulAnalysis(streamedContent, ndjsonError)) {
        setUsageCount((c) => c + 1);
      }
    } catch (e) {
      setSearching(false);
      const errMsg = "⚠️ Something went wrong pulling live data. Try again in 10–20 seconds.";
      setMsgs(p => {
        const n = [...p];
        const last = n[n.length - 1];
        if (last?.role === "assistant" && !String(last.text || "").trim()) {
          n[n.length - 1] = { role:"assistant", text: errMsg };
        }
        return n;
      });
    }
    setBusy(false);
  }

  const quickBtns = [
    { label:"🔥 Today's top deals", prompt:"Show me today's top deals under $650k in QLD ranked by deal score" },
    { label:"🏡 Score a suburb", prompt:"Score Geraldton WA as an investment — BUY or AVOID?" },
    { label:"⚖️ Compare suburbs", prompt:"Compare Kirwan vs Aitkenvale QLD" },
    { label:"💰 Analyse a deal", prompt:"3 bed house Mackay QLD $585,000 rent $600 per week — is this undervalued? Run full deal analysis." },
    { label:"📡 Opportunity Radar", prompt:"Run the opportunity radar for under $600k across QLD and WA — rank by deal score" },
  ];

  const remaining = FREE_LIMIT - usageCount;
  const showPaywall = !isPro && usageCount >= FREE_LIMIT;

  function handleDownloadPdf() {
    const last = msgs.at(-1);
    if (last?.role !== "assistant") return;
    const t = String(last.text || "").trim();
    if (!t) return;
    buildBrandedPdf(t, { compareMeta: last.compareMeta });
  }

  const showPdfDownload =
    !busy &&
    msgs.some((m) => m.role === "user") &&
    msgs.at(-1)?.role === "assistant" &&
    String(msgs.at(-1)?.text || "").trim().length > 0;

  const lastAssistantText = String(msgs.at(-1)?.text || "");
  const showMortgageCalc = showPdfDownload && shouldShowMortgageCalculator(lastAssistantText);

  if (screen === "landing") return React.createElement(Landing, { onStart: handleStart });

  return React.createElement(React.Fragment, null,
    React.createElement("style", null, `
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      html,body,#root{height:100%;background:#080a0e}
      body{font-family:'IBM Plex Mono',monospace;color:#e8e6e0}
      ::-webkit-scrollbar{width:4px;height:4px}
      ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
      @keyframes bounce{0%,80%,100%{opacity:.2;transform:scale(.7)}40%{opacity:1;transform:scale(1)}}
      @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
      @keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .qb:hover{border-color:#e8b84b!important;color:#e8e6e0!important;background:rgba(232,184,75,0.05)!important}
      textarea,input{outline:none}
    `),

    React.createElement("div", { style:{ display:"grid", gridTemplateColumns:"240px 1fr", gridTemplateRows:"56px 1fr", height:"100vh", overflow:"hidden", background:"#080a0e" } },

      // HEADER
      React.createElement("div", { style:{ gridColumn:"1/-1", background:"#0e1117", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", padding:"0 22px", gap:12 } },
        React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:8 } },
          React.createElement("div", { style:{ width:28, height:28, background:"#e8b84b", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:12, color:"#000" } }, "P"),
          React.createElement("div", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15 } }, "PropAI")
        ),
        React.createElement("div", { style:{ fontSize:9, color:"#4ade80", background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:20, padding:"2px 10px" } }, "🔍 LIVE"),
        React.createElement("div", { style:{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 } },
          !isPro && React.createElement("div", { style:{ fontSize:11, color: remaining <= 1 ? "#f87171" : "#6b7280" } },
            remaining > 0 ? `${remaining} free ${remaining===1?"analysis":"analyses"} left — then unlock unlimited` : "Free limit reached"
          ),
          !isPro && React.createElement("button", { onClick:handleUpgrade, style:{ fontSize:11, background:"#e8b84b", color:"#000", border:"none", borderRadius:8, padding:"5px 14px", cursor:"pointer", fontFamily:"monospace", fontWeight:700 } }, "Upgrade $49/mo"),
          isPro && React.createElement("div", { style:{ fontSize:10, color:"#4ade80", background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:20, padding:"3px 10px" } }, "⭐ PRO"),
          React.createElement("button", { onClick:()=>setScreen("landing"), style:{ fontSize:10, color:"#4b5563", background:"none", border:"none", cursor:"pointer" } }, "← Home")
        )
      ),

      // SIDEBAR
      React.createElement("div", { style:{ background:"#0e1117", borderRight:"1px solid rgba(255,255,255,0.06)", padding:"20px 14px", display:"flex", flexDirection:"column", gap:4, overflowY:"auto" } },
        React.createElement("div", { style:{ fontSize:9, letterSpacing:"0.15em", textTransform:"uppercase", color:"#4b5563", padding:"6px 8px 10px" } }, "Quick Actions"),
        ...quickBtns.map((b,i) => React.createElement("button", { key:i, className:"qb", onClick:()=>{ if(!busy && (isPro || usageCount < FREE_LIMIT)) sendMsg(b.prompt); }, style:{ display:"flex", alignItems:"center", gap:8, padding:"9px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.06)", background:"transparent", color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, cursor:"pointer", textAlign:"left", width:"100%", transition:"all 0.15s" } }, b.label)),

        React.createElement("div", { style:{ margin:"16px 0 8px", height:"1px", background:"rgba(255,255,255,0.06)" } }),
        React.createElement("div", { style:{ fontSize:9, letterSpacing:"0.15em", textTransform:"uppercase", color:"#4b5563", padding:"4px 8px 10px" } }, "How To Use"),
        ...["Type any suburb name + state", "Paste property: suburb, price, rent", "Ask for today's deals", "Compare: Kirwan vs Aitkenvale QLD"].map((tip,i) =>
          React.createElement("div", { key:i, style:{ padding:"7px 10px", fontSize:10, color:"#4b5563", lineHeight:1.5 } }, `• ${tip}`)
        ),

        React.createElement("div", { style:{ marginTop:"auto", padding:"14px 10px 0" } },
          React.createElement("div", { style:{ background:"#181c24", borderRadius:10, padding:"12px 14px", fontSize:11 } },
            React.createElement("div", { style:{ color:"#6b7280", marginBottom:4 } }, "⚠️ Disclaimer"),
            React.createElement("div", { style:{ color:"#4b5563", lineHeight:1.6, fontSize:10 } }, "Not financial advice. Always consult a mortgage broker and conveyancer before purchasing.")
          )
        )
      ),

      // MAIN CHAT (minWidth:0 so nested max-width:800px can use full grid column on desktop)
      React.createElement("div", { style:{ gridColumn:2, minWidth:0, overflow:"hidden", display:"flex", flexDirection:"column", background:"#080a0e" } },
        // Messages
        React.createElement("div", { style:{ flex:1, overflowY:"auto", padding:"20px 28px", display:"flex", flexDirection:"column", gap:16 } },
          ...msgs.map((m,i) => {
            const lastAssistantSearching =
              m.role === "assistant" &&
              i === msgs.length - 1 &&
              !m.text &&
              (searching || busy);
            const compareParsed = m.role === "assistant" ? parsePropaiCompareBlock(m.text) : null;
            const compareLayout = m.role === "assistant" && (!!m.compareMeta || !!compareParsed);
            return React.createElement("div", { key:i, style:{ display:"flex", gap:10, flexDirection:m.role==="user"?"row-reverse":"row", alignSelf:m.role==="user"?"flex-end":"stretch", width:m.role==="assistant"?"100%":undefined, maxWidth:m.role==="user"?"min(520px, 88%)":"min(800px, 100%)", animation:"fu 0.3s ease both" } },
            React.createElement("div", { style:{ width:30, height:30, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, flexShrink:0, background:m.role==="assistant"?"rgba(232,184,75,0.1)":"#181c24", border:`1px solid ${m.role==="assistant"?"rgba(232,184,75,0.25)":"rgba(255,255,255,0.06)"}` } }, m.role==="assistant"?"🏡":"👤"),
            React.createElement("div", { style:{ flex:m.role==="assistant"?1:undefined, minWidth:0, padding: compareLayout ? "14px 16px" : "12px 16px", borderRadius:12, fontSize:13, lineHeight:1.75, background:m.role==="assistant"?"#0e1117":"#e8b84b", color:m.role==="assistant"?"#e8e6e0":"#080a0e", border:m.role==="assistant"?"1px solid rgba(255,255,255,0.06)":"none", borderTopLeftRadius:m.role==="assistant"?3:12, borderTopRightRadius:m.role==="user"?3:12 } },
              lastAssistantSearching
                ? React.createElement(React.Fragment, null,
                    React.createElement("span", { style:{ animation:"pulse 1.2s infinite", color:"#4ade80" } }, "🔍"),
                    React.createElement("span", { style:{ fontSize:11, color:"#4ade80", animation:"pulse 1.2s infinite", marginLeft:8 } }, msgs.at(-1)?.compareMeta ? "Comparing suburbs (2 live searches)…" : "Searching live data...")
                  )
                : m.role === "assistant"
                  ? renderAssistantContent(m)
                  : renderChatContent(m.text)
            )
            );
          }),
          busy && msgs.at(-1)?.role !== "assistant" && React.createElement("div", { style:{ display:"flex", gap:10, alignSelf:"flex-start", animation:"fu 0.3s ease both" } },
            React.createElement("div", { style:{ width:30, height:30, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, background:"rgba(232,184,75,0.1)", border:"1px solid rgba(232,184,75,0.25)" } }, "🏡"),
            React.createElement("div", { style:{ padding:"12px 16px", borderRadius:12, borderTopLeftRadius:3, background:"#0e1117", border:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", gap:8 } },
              searching
                ? React.createElement(React.Fragment, null,
                    React.createElement("span", { style:{ animation:"pulse 1.2s infinite", color:"#4ade80" } }, "🔍"),
                    React.createElement("span", { style:{ fontSize:11, color:"#4ade80", animation:"pulse 1.2s infinite" } }, "Searching live data...")
                  )
                : [0,0.2,0.4].map((d,i)=>React.createElement("span",{key:i,style:{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#e8b84b",animation:`bounce 1.2s ease-in-out ${d}s infinite`}}))
            )
          ),
          showPaywall && React.createElement(Paywall, { used:usageCount, onUpgrade:handleUpgrade }),
          React.createElement("div", { ref:bottomRef })
        ),

        showPdfDownload && React.createElement("div", { style:{ padding:"0 28px 12px", flexShrink:0 } },
          React.createElement("button", {
            type:"button",
            onClick: handleDownloadPdf,
            style:{
              display:"inline-flex",
              alignItems:"center",
              gap:8,
              padding:"10px 16px",
              borderRadius:10,
              border:"1px solid rgba(232,184,75,0.35)",
              background:"rgba(232,184,75,0.08)",
              color:"#e8b84b",
              fontFamily:"'IBM Plex Mono',monospace",
              fontSize:12,
              fontWeight:600,
              cursor:"pointer",
              transition:"background 0.15s"
            }
          }, "⬇ Download PDF Report")
        ),

        showMortgageCalc &&
          React.createElement(MortgageCalculatorPanel, {
            key: msgs.length,
            analysisText: lastAssistantText
          }),

        // Input area
        React.createElement("div", { style:{ borderTop:"1px solid rgba(255,255,255,0.06)", padding:"14px 28px", background:"#0e1117", display:"flex", flexDirection:"column", gap:10 } },
          !showPaywall && React.createElement("div", { style:{ display:"flex", gap:6, flexWrap:"wrap" } },
            ...["🔥 Today's top deals QLD", "Score Geraldton WA", "Mackay $585k $600pw deal?", "WA Opportunity Radar"].map((s,i) =>
              React.createElement("button", { key:i, className:"qb", onClick:()=>{ if(!busy && (isPro || usageCount < FREE_LIMIT)) sendMsg(s); }, style:{ fontSize:10, padding:"3px 10px", borderRadius:20, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#4b5563", cursor:"pointer", transition:"all 0.15s", fontFamily:"monospace" } }, s)
            )
          ),
          React.createElement("div", { style:{ display:"flex", gap:10, alignItems:"flex-end" } },
            React.createElement("textarea", { ref:inputRef, value:input, onChange:e=>setInput(e.target.value), onKeyDown:e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}, placeholder: showPaywall ? "Upgrade to Pro to continue..." : "Ask about any suburb, or paste a property — suburb, price, rent...", disabled:showPaywall||busy, rows:1, style:{ flex:1, background:showPaywall?"#0e1117":"#181c24", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"10px 14px", color:"#e8e6e0", fontFamily:"'IBM Plex Mono',monospace", fontSize:13, resize:"none", lineHeight:1.5, opacity:showPaywall?0.4:1 } }),
            React.createElement("button", { onClick:()=>sendMsg(), disabled:busy||!input.trim()||showPaywall, style:{ width:42, height:42, borderRadius:10, border:"none", background:busy||!input.trim()||showPaywall?"rgba(232,184,75,0.25)":"#e8b84b", color:"#000", cursor:busy||!input.trim()||showPaywall?"not-allowed":"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 } }, "↑")
          )
        )
      )
    )
  );
}
