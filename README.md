# Prototype for embodied emissions dashboard

Scroll-driven D3 storyboard showing scope-decomposed emissions and tiered upstream/downstream Sankey flows for country–sector pairs. Currently holds data for top 50 of the 2022 OECD ICIOs, served via Cloudflare R2.

Deployed on Cloudflare Pages: [supem-prototype.pages.dev](https://supem-prototype.pages.dev/)

## Quick start
- `npm install` — install dependencies
- `npm run dev` — local dev server
- `npm run build` — production build
- `npx wrangler pages deploy dist` — deploy to Cloudflare Pages

## Data pipeline
- `python -m pipelines.main compute --top-n 50` — compute data for top 50 pairs
- `python -m pipelines.main upload` — upload to R2

## Structure
- `src/main.js` — app entry, scroll controller
- `src/layers/` — D3 visualization layers (SplitBar, Sankey)
- `pipelines/` — Python data pipeline (compute, layout, storage)
- `functions/` — Cloudflare Pages Functions (R2 proxy)
