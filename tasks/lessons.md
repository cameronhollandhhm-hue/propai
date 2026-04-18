## 2026-04-18 - Misplaced file contents caused broken build

- Root cause: critical file contents were shifted into the wrong filenames (`package.json`, `main.jsx`, `vite.config.js`, `App.jsx`, `api/analyze.js`), which made the project invalid before Vite could build.
- Prevention:
  - Keep canonical file-role checklist for React + Vite projects before deploy (`package.json` JSON, `vite.config.js` config, app entrypoint, `src/App.jsx` UI, `vercel.json` platform config).
  - After major edits or merges, run a quick "file-role sanity pass" by opening those core files before pushing.
  - Treat any cross-language mismatch (JSON in `.jsx`, JS in `.json`) as a release blocker.
