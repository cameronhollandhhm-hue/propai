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
