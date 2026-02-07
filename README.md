# Prototype for embodied emissions dashboard

Scroll-driven D3 story showing an emissions trend, component split, and tiered Sankey flows for a single country–sector pair. 

Deployed with cloudflare pages [here](https://supem-prototype.pages.dev/).

## Quick start
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

## Data
Currently using stub data (no actual data) for ICIO derived values.
Static JSON files are served from `public/data`. The app loads them in `src/main.js`.

## Structure
- Entry: `index.html`
- App code: `src/main.js`
- Layers: `src/layers`
- Scene state: `src/lib/sceneController.js`
