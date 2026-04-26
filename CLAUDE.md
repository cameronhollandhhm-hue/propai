# CLAUDE.md

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes -- don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -- then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to tasks/todo.md with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to tasks/todo.md
6. **Capture Lessons**: Update tasks/lessons.md after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Only touch what's necessary.

---

## PropAI — Project-Specific Rules

PropAI is an AI-powered Australian property research web app for rentvestors. Live at propai-five.vercel.app. Stripe integrated at $49/mo with 3 free analyses.

### Owner context

- Owner: Cam Holland, Sydney-based entrepreneur, not a professional developer.
- Communication: extremely direct, no fluff, no preamble. Give copy-paste-ready code. Do not gatekeep or pace.
- When Cam asks for a fix, assume he wants the shortest path to a working deploy, not a refactor.

### Stack

- Frontend: `src/App.jsx` (single-file React, streaming chat, jsPDF via `buildBrandedPdf`).
- Backend: `api/analyze.js` (serverless Vercel function, Anthropic `claude-sonnet-4-5`, web search, Microburbs fallback, 60s timeout, streaming response).
- Anthropic Tier 2 (450k tokens/min).
- Deployment: GitHub → Vercel auto-deploy on push to `main`.

### Brand tokens (do not change without asking)

- CREAM `#f5efe3`
- FOREST `#2d4a2b`
- ORANGE `#d96b2c`
- CRIMSON (red flags)
- Display font: Times (proxy for Instrument Serif)
- Body font: Helvetica (proxy for Manrope)

### Structured output contract (SYSTEM_PROMPT in api/analyze.js)

The AI must emit these markers in every analysis. Parsers in App.jsx depend on them exactly.

- `[[PROPAI_SCORE]] N/100` — deal score
- `[[PROPAI_WALKAWAY]] $Xk - $Yk` — walk-away price range
- `[[PROPAI_VERDICT]] BUY` | `HOLD` | `SKIP`
- `[[PROPAI_COMPARE]] ... [[/PROPAI_COMPARE]]` — compare payload with `suburb1` and `suburb2` keys (NOT suburbA/suburbB)
- `[[BULL_START]] ... [[BULL_END]]` — bull case body
- `[[BEAR_START]] ... [[BEAR_END]]` — bear case / red flags body
- `[[CASHFLOW_START]] ... [[CASHFLOW_END]]` — cashflow snapshot body

When adding or modifying markers, update BOTH the SYSTEM_PROMPT in `api/analyze.js` AND the parsers in `src/App.jsx`.

### Parser conventions

- `parsePropaiScore(text)` — regex `/\[\[PROPAI_SCORE\]\]\s*(\d+)\s*\/\s*100/i`
- `parsePropaiCompareBlock` returns `{ suburb1, suburb2 }` — PDF code must use these keys
- `extractSection(text, tag)` — generic section extractor using `[[TAG_START]] ... [[TAG_END]]`
- `extractSuburbName(analysisText, userPrompt)` — must NEVER return the word "Report". Falls back to "Property".
- `cleanForDisplay(text)` — strips markers for chat UI only. Do NOT apply to text passed to `buildBrandedPdf`.

### Writing quality rules for AI output

Add or maintain these in SYSTEM_PROMPT:

- Australian English spelling: neighbour, analyse, favour, realise.
- Australian dollars: $580K or $580,000. Never "580k" lowercase in headings.
- No typos, no doubled words, no missing words. Proofread before emitting.
- Every bullet = complete sentence ending with a period.
- Em-dash with spaces: " — " not "—".
- Numbers under 10 spelled out in prose; digits in tables/metrics.
- Proper nouns capitalised consistently: Defence, James Cook University, Lavarack Barracks.
- No marketing fluff: avoid "absolutely", "truly", "very", "really", "literally", "game-changer", "next-level", "unlock", "leverage" (unless financial leverage).
- First mention of suburb: "Kirwan (QLD 4817)". Subsequent: "Kirwan".

### API error handling

- Wrap all `anthropic.messages.create` calls in `callAnthropicWithRetry` with 3 retries and exponential backoff (2s, 4s, 8s) on status 429, 503, 529.
- On final failure, stream back: "The AI service is experiencing heavy load right now. Please wait 30 seconds and try again. Your free analysis has not been used."
- Do NOT decrement the free analysis counter on failed requests. Only count successful full responses.

### PDF layout (buildBrandedPdf)

- Cover: title auto-fit 72pt → 36pt floor.
- Page 2: Executive summary — deal score + verdict + walk-away + cashflow snapshot block.
- Page 3: Metrics snapshot (6 cards with letter grades).
- Page 4: Bull case (rendered from `extractSection(text, 'BULL')`).
- Page 5: Bear case / red flags (rendered from `extractSection(text, 'BEAR')`).
- Page 6: Walk-away number + final call.
- Page 7 (compare mode only): Side-by-side compare table using `suburb1` / `suburb2` keys.

### What NOT to do

- Do not change brand tokens, fonts, or PDF layout without explicit instruction.
- Do not rename existing function names unless fixing a known bug.
- Do not remove existing features (mortgage calculator, PDF download, Stripe link, compare mode).
- Do not introduce new dependencies without confirming first.
- Do not commit. Cam commits manually via GitHub Desktop.
- Do not invent markers the PDF parsers don't know about.

### Deploy flow (reference, do not run)

1. Cursor makes changes.
2. Cam reviews + accepts in Cursor.
3. Cam commits + pushes via GitHub Desktop.
4. Vercel auto-deploys.
5. Cam hard-refreshes propai-five.vercel.app and tests.


