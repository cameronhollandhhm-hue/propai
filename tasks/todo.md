# Compare mode PDF regression fix plan (Apr 26)

## Discovery checklist

- [x] Read `api/analyze.js` `SYSTEM_PROMPT` output contract in full.
- [x] Verify compare-mode prompt requirements for `[[PROPAI_SCORE]]`, `[[PROPAI_VERDICT]]`, `[[PROPAI_WALKAWAY]`, `##` sections, and `[[PROPAI_COMPARE]]`.
- [x] Read `src/App.jsx` `buildBrandedPdf` and all page render functions.
- [x] Confirm whether compare mode uses a different page 1-6 renderer path (it does not; same pages, compare only adds page 7).
- [x] Inspect cover subtitle rendering path for duplicate drawing.
- [x] Inspect metrics card rendering path for duplicated value/grade visuals.
- [x] Inspect bull/bear/walkaway/final-call parse paths against current `##` contract.

## Fix checklist

- [x] Implement parser normalization for current `##` contract so compare and suburb modes share the exact same extracted data model.
- [x] Add robust score/verdict/walkaway fallbacks for compare text where marker presence is inconsistent.
- [x] Remove duplicate subtitle rendering on cover (render once only).
- [x] Remove misleading metrics "grade pill" duplication behavior for data values and ensure six real card values map correctly.
- [x] Make bull and bear section extraction resilient to compare content formatting.
- [x] Ensure page 6 walk-away and final call are populated from normalized parsed output.
- [x] Make compare page (page 7) merge JSON compare data + text-derived fallback per field, not all-or-nothing.
- [x] Keep layout/brand tokens/fonts unchanged.
- [x] Run lints for edited files and fix introduced issues.

## Review checklist

- [ ] Summarize root causes per broken page.
- [ ] List changed files.
- [ ] Provide explicit post-deploy test queries and page-by-page validation checklist.

# PropAI landing redesign integration plan

## Discovery + constraints

- [x] Read `CLAUDE.md` and follow plan-first workflow.
- [x] Read current `src/App.jsx` to preserve existing app logic.
- [x] Read `main.jsx`.
- [x] Attempt to read `index.html` (file is currently missing from repository).
- [x] Confirm required behavior to preserve:
  - existing `/api/analyze` POST flow in `sendMsg`
  - existing form input + submit handlers
  - existing response rendering and error states
  - existing paywall/free-limit logic

## Styling approach decision

- [x] Choose CSS strategy: use a scoped `<style>` block inside `src/App.jsx` for the new landing markup.
- [x] Rationale captured:
  - HTML provided is full class-based CSS (large + structured), so direct class migration is safest.
  - Avoids introducing new dependencies (`styled-components`) or a Tailwind migration.
  - Keeps integration localized to `src/App.jsx` without changing app architecture.

## Implementation plan (do after user says "go")

- [ ] Refactor `Landing` from `React.createElement` to JSX in `src/App.jsx` using the provided design structure.
- [ ] Port Google Fonts (`Instrument Serif`, `Manrope`, `JetBrains Mono`) via CSS import in the landing style block.
- [ ] Include all 10 required sections in landing JSX:
  - [ ] Nav
  - [ ] Hero
  - [ ] Trust strip
  - [ ] Why
  - [ ] Demo
  - [ ] Features
  - [ ] Compare
  - [ ] Proof
  - [ ] Pricing
  - [ ] Final
  - [ ] Footer
- [ ] Wire CTA actions to existing analyse flow:
  - [ ] `Analyse a Property →` triggers existing app entry/analyse journey (uses current `onStart` + analysis UI flow).
  - [ ] `Analyse a Property Now →` triggers the same existing analyse journey.
- [ ] Preserve all existing app logic untouched outside landing UI scope:
  - [ ] `sendMsg` request body + timeout/error handling
  - [ ] chat input and quick actions behavior
  - [ ] result rendering (`renderText`)
  - [ ] free/pro upgrade behavior
- [ ] Ensure section anchor links (`#why`, `#demo`, `#features`, `#pricing`, `#final`) work with JSX ids.
- [ ] Keep accessibility-safe button usage where actions are local (replace non-functional `href="#"` CTAs with buttons where appropriate).
- [ ] Run lint diagnostics for edited files and fix any introduced issues.

## Verification plan (do after implementation)

- [ ] Manual flow check:
  - [ ] Landing renders with new design and typography.
  - [ ] Clicking primary CTA moves user into existing analysis app screen.
  - [ ] Submit test prompt and verify `/api/analyze` response renders.
  - [ ] Busy/searching/error states still behave correctly.
- [ ] Regression check:
  - [ ] Free-limit/paywall behavior unchanged.
  - [ ] Upgrade action still opens Stripe link and toggles Pro state.
  - [ ] No layout-breaking issues on common responsive breakpoints.

## Review section (to fill after implementation)

- [ ] Document exact files changed and why.
- [ ] Document verification results + residual risks.

# PropAI build failure recovery plan

## Investigation findings

- [x] Read `CLAUDE.md` and follow plan-first workflow.
- [x] Read requested files: `package.json`, `vite.config.js`, `main.jsx`, `App.jsx`, `PropAI-FINAL.jsx`.
- [x] List files in `api/` and `src/`.
- [x] Attempt dependency install with `npm install`.
- [x] Attempt build with `npm run build`.

## Exact command output captured

- [x] `npm install` fails in current shell environment:
  - `npm : The term 'npm' is not recognized as the name of a cmdlet, function, script file, or operable program.`
- [x] `npm run build` is currently blocked for the same reason (`npm` missing in PATH).

## Root cause diagnosis (No Laziness)

- [x] Primary repository issue identified: key files are corrupted/misplaced, not merely a minor syntax error.
  - `package.json` contains large React component source (looks like the `PropAI-FINAL.jsx` app code), not JSON package metadata.
  - `main.jsx` contains Vite config code (`defineConfig` + `@vitejs/plugin-react`) instead of React app bootstrap.
  - `App.jsx` at repo root contains Vercel JSON config (`rewrites`/`functions`) instead of React component code.
  - `src/App.jsx` contains a different minimal app, which conflicts with the apparent intended production UI in `PropAI-FINAL.jsx`.
- [x] Consequence: Vite build/deploy cannot succeed until project entry/config files are restored to coherent roles.
- [x] Secondary impact: rate-limit caching fix in `api/analyze.js` is not shipping because deploy pipeline is blocked upstream.

## Planned fix tasks

- [x] Restore canonical project file mapping:
  - [x] Recreate valid JSON `package.json` with correct scripts/dependencies for React + Vite.
  - [x] Ensure `vite.config.js` contains Vite config only.
  - [x] Ensure `main.jsx` contains React DOM entrypoint only.
  - [x] Ensure `src/App.jsx` is the intended production app component.
  - [x] Move Vercel config data out of `App.jsx` into `vercel.json` (or existing expected config file).
- [x] Decide source-of-truth UI file:
  - [x] Diff `PropAI-FINAL.jsx` vs `src/App.jsx`.
  - [x] Promote the intended version into `src/App.jsx` with minimal edits.
  - [x] Keep `PropAI-FINAL.jsx` as archive or remove once safely migrated.
- [x] Verify backend fix continuity:
  - [x] Confirm `api/analyze.js` retains cache/rate-limit behavior after frontend cleanup.
- [ ] Reinstall and rebuild:
  - [ ] Run `npm install`. (blocked: `npm` is not available in this shell)
  - [ ] Run `npm run build`. (blocked: `npm` is not available in this shell)
  - [ ] Capture zero-error build output.
- [ ] Deployment confidence checks:
  - [ ] Smoke-test app locally with production build preview.
  - [ ] Validate key user flow calls `/api/analyze`.
  - [ ] Confirm no regressions to API error handling and timeout behavior.

## Review section (to update after implementation)

- [x] Document exactly what was changed and why.
- [ ] Include final verification logs and residual risks.
