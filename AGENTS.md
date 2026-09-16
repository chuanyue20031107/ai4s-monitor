# Repository instructions

This repository is GitHub-native and must remain independent from proprietary app platforms.

- Frontend: React + Vite in `client/`.
- Persistence: versioned JSON files in `client/public/data/`.
- Automation: `.github/workflows/crawl-and-deploy.yml` and `scripts/crawl.mjs`.
- Hosting: GitHub Pages.
- Do not add platform SDKs, private capability clients, external databases, or secrets to the frontend.
- Keep crawling deterministic, bounded, respectful of timeouts, and safe to rerun.
- Validate changes with `npm run typecheck` and `npm run build`.
