import './style.css';
import * as d3 from 'd3';
import scrollama from 'scrollama';
import { createSceneController } from './lib/sceneController.js';
import { createMorphController } from './lib/morphController.js';
import { COMPONENT_COLORS, TIER_COLORS } from './lib/colors.js';
import { createTrendBarLayer } from './layers/TrendBarLayer.js';
import { createSplitBarLayer } from './layers/SplitBarLayer.js';
import { createSankeyLayer } from './layers/SankeyLayer.js';
import { createTooltip } from './layers/Tooltip.js';

// ── Data loading ──

// Determine base URL: use API in production, local files in dev
const API_BASE = '/api/v1';
const LOCAL_BASE = '/data/v1';

async function tryFetch(url) {
  try {
    return await d3.json(url);
  } catch {
    return null;
  }
}

async function loadManifest() {
  // Try API first, fall back to local file
  let manifest = await tryFetch(`${API_BASE}/manifest`);
  if (!manifest) manifest = await tryFetch(`${API_BASE}/manifest.json`);
  if (!manifest) manifest = await tryFetch(`${LOCAL_BASE}/manifest.json`);
  return manifest;
}

async function loadPairData(iso3, isic) {
  // Try API path, fall back to local generated files
  let base = `${API_BASE}/${iso3}/${isic}`;

  const tryLoad = async (b) => {
    const [trend, split, upT1, upT2, upT3, dnT1, dnT2, dnT3] = await Promise.all([
      d3.json(`${b}/trend.json`),
      d3.json(`${b}/split.json`),
      d3.json(`${b}/sankey_upstream_t1.json`),
      d3.json(`${b}/sankey_upstream_t2.json`),
      d3.json(`${b}/sankey_upstream_t3.json`),
      d3.json(`${b}/sankey_downstream_t1.json`),
      d3.json(`${b}/sankey_downstream_t2.json`),
      d3.json(`${b}/sankey_downstream_t3.json`),
    ]);
    return { trend, split, upT1, upT2, upT3, dnT1, dnT2, dnT3 };
  };

  try {
    return await tryLoad(base);
  } catch {
    // Fall back to local generated files
    base = `${LOCAL_BASE}/${iso3}/${isic}`;
    return await tryLoad(base);
  }
}

// ── Dropdown population ──

function populateDropdowns(manifest, onSelect) {
  const countrySelect = document.getElementById('country-select');
  const sectorSelect = document.getElementById('sector-select');
  if (!countrySelect || !sectorSelect) return;

  // Build lookup of available pairs
  const availablePairs = new Set(manifest.pairs.map(p => `${p.iso3}|${p.isic}`));
  const countriesWithPairs = new Set(manifest.pairs.map(p => p.iso3));
  const sectorsWithPairs = new Set(manifest.pairs.map(p => p.isic));

  // Populate country dropdown (only countries that have computed pairs)
  const countries = manifest.countries
    .filter(c => countriesWithPairs.has(c.iso3))
    .sort((a, b) => a.name.localeCompare(b.name));

  countrySelect.innerHTML = countries
    .map(c => `<option value="${c.iso3}">${c.name}</option>`)
    .join('');

  // Populate sector dropdown
  const sectors = manifest.sectors
    .filter(s => sectorsWithPairs.has(s.isic))
    .sort((a, b) => a.name.localeCompare(b.name));

  sectorSelect.innerHTML = sectors
    .map(s => `<option value="${s.isic}">${s.name}</option>`)
    .join('');

  // Update sector options based on selected country
  function updateSectorOptions(selectedIso3) {
    const validSectors = manifest.pairs
      .filter(p => p.iso3 === selectedIso3)
      .map(p => p.isic);
    const validSet = new Set(validSectors);

    Array.from(sectorSelect.options).forEach(opt => {
      opt.disabled = !validSet.has(opt.value);
    });

    // If current sector is not valid for new country, pick first valid
    if (!validSet.has(sectorSelect.value)) {
      const firstValid = sectors.find(s => validSet.has(s.isic));
      if (firstValid) sectorSelect.value = firstValid.isic;
    }
  }

  // Set default to top-ranked pair
  const defaultPair = manifest.pairs[0];
  if (defaultPair) {
    countrySelect.value = defaultPair.iso3;
    sectorSelect.value = defaultPair.isic;
    updateSectorOptions(defaultPair.iso3);
  }

  // Event handlers
  countrySelect.addEventListener('change', () => {
    updateSectorOptions(countrySelect.value);
    onSelect(countrySelect.value, sectorSelect.value);
  });

  sectorSelect.addEventListener('change', () => {
    onSelect(countrySelect.value, sectorSelect.value);
  });

  return { countrySelect, sectorSelect };
}

// ── Update storyboard text ──

function updateStoryText(data) {
  const trend = data.trend;
  const split = data.split;
  const countryName = trend.countryName;
  const sectorName = trend.sectorName;
  const focusYear = split.year;
  const total = split.total;

  // Find scope values
  const s3u = split.components.find(c => c.key === 'S3U');
  const s3d = split.components.find(c => c.key === 'S3D');
  const s3uPct = s3u ? Math.round(s3u.share * 100) : 0;

  // Update step text content via data attributes
  document.querySelectorAll('[data-pair-country]').forEach(el => {
    el.textContent = countryName;
  });
  document.querySelectorAll('[data-pair-sector]').forEach(el => {
    el.textContent = sectorName;
  });
  document.querySelectorAll('[data-focus-year]').forEach(el => {
    el.textContent = focusYear;
  });
  document.querySelectorAll('[data-total-value]').forEach(el => {
    el.textContent = total.toFixed(1);
  });

  // Update split legend
  const legendEl = document.getElementById('split-legend');
  if (legendEl && split.components) {
    legendEl.innerHTML = split.components
      .map(c => {
        const color = COMPONENT_COLORS[c.key] || '#888';
        return `<li><strong style="color:${color}">${c.label}</strong> — ${c.value.toFixed(1)} Mt</li>`;
      })
      .join('');
  }

  // Update upstream stats
  const upValueEl = document.getElementById('upstream-value');
  if (upValueEl && s3u) {
    upValueEl.textContent = `${s3u.value.toFixed(1)}`;
  }
  const upPctEl = document.getElementById('upstream-pct');
  if (upPctEl) {
    upPctEl.textContent = `${s3uPct}%`;
  }

  // Update downstream stats
  const dnValueEl = document.getElementById('downstream-value');
  if (dnValueEl && s3d) {
    dnValueEl.textContent = `${s3d.value.toFixed(1)}`;
  }
}

// ── Main ──
async function main() {
  // Try to load manifest for dynamic mode
  const manifest = await loadManifest();

  // SVG setup
  const svgEl = document.getElementById('viz');
  const container = document.getElementById('sticky-viz');
  const rect = container.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;

  const svg = d3.select(svgEl)
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const margin = { top: 60, right: 60, bottom: 60, left: 70 };

  // Tooltip
  const tooltip = createTooltip('#tooltip');

  // ── Create layers ──
  const trendLayer = createTrendBarLayer(svg, { margin, width: W, height: H });
  const splitLayer = createSplitBarLayer(svg, { margin, width: W, height: H });
  const sankeyLayer = createSankeyLayer(svg, { margin, width: W, height: H, tooltip });
  const morphCtrl = createMorphController(svg, { margin });

  // ── Scene controller (will be re-created on pair change) ──
  let controller = null;
  let currentData = null;

  function initWithData(data) {
    currentData = data;

    const focusYear = data.split.year;

    trendLayer.init(data.trend);
    splitLayer.init(data.split);

    sankeyLayer.loadTierData('upstream', 1, data.upT1);
    sankeyLayer.loadTierData('upstream', 2, data.upT2);
    sankeyLayer.loadTierData('upstream', 3, data.upT3);
    sankeyLayer.loadTierData('downstream', 1, data.dnT1);
    sankeyLayer.loadTierData('downstream', 2, data.dnT2);
    sankeyLayer.loadTierData('downstream', 3, data.dnT3);

    controller = createSceneController({
      focusYear,
      maxTierUpstream: 3,
      maxTierDownstream: 3,
    });

    updateStoryText(data);
  }

  // ── Morph transition handlers ──

  function renderMorphA(state, dur) {
    const barBounds = trendLayer.getBarBounds(state.focusYear);
    const targetSegs = splitLayer.getAllSegmentBounds();
    if (!barBounds || !targetSegs) return false;

    morphCtrl.morphTrendToSplit({
      sourceBounds: barBounds,
      segments: currentData.split.components,
      targetSegments: targetSegs,
      dur,
      onStart: () => {
        trendLayer.hideBar(state.focusYear);
        trendLayer.g.transition().duration(dur * 0.5).attr('opacity', 0);
      },
      onComplete: () => {
        splitLayer.g.attr('opacity', 1);
        splitLayer.update(state, dur * 0.5);
        trendLayer.g.attr('opacity', 0);
      },
    });
    return true;
  }

  function renderMorphB(state, direction, dur) {
    // Map direction to scope key for segment lookup
    const segKey = direction === 'upstream' ? 'S3U' : 'S3D';
    const segBounds = splitLayer.getSegmentBounds(segKey);
    const rootBounds = sankeyLayer.getRootBounds(direction);
    if (!segBounds || !rootBounds) return false;

    morphCtrl.morphSegmentToSankeyRoot({
      segmentBounds: segBounds,
      segmentColor: COMPONENT_COLORS[segKey],
      rootBounds: rootBounds,
      rootColor: TIER_COLORS[0],
      dur,
      onStart: () => {
        splitLayer.hideSegment(segKey);
        splitLayer.g.selectAll('.split-rect')
          .filter(d => d.key !== segKey)
          .transition().duration(dur * 0.4).attr('opacity', 0);
        splitLayer.g.selectAll('.split-label-g')
          .transition().duration(dur * 0.3).attr('opacity', 0);
      },
      onComplete: () => {
        splitLayer.g.attr('opacity', 0);
        sankeyLayer.g.attr('opacity', 1);
        sankeyLayer.update(state, dur, { rootPreVisible: true });
        sankeyLayer.updateOverlay(state, dur);
      },
    });
    return true;
  }

  // ── Render function ──
  let prevMode = null;

  function render(state, dur = 700) {
    const mode = state.mode;
    const modeChanged = mode !== prevMode;
    prevMode = mode;

    // Cancel any in-progress morph on new render
    if (morphCtrl.isActive()) {
      morphCtrl.cancel();
    }

    // ── Detect morph transitions (forward only) ──
    const prev = state.prevMode;
    const isMorphA = prev === 'trend_zoom_last' && mode === 'splitBar';
    const isMorphB_up = prev === 'splitBar_upstreamFocus' && mode === 'sankey_upstream';
    const isMorphB_dn = prev === 'splitBar_downstreamFocus' && mode === 'sankey_downstream';

    if (isMorphA) {
      if (renderMorphA(state, dur)) return;
    }
    if (isMorphB_up) {
      if (renderMorphB(state, 'upstream', dur)) return;
    }
    if (isMorphB_dn) {
      if (renderMorphB(state, 'downstream', dur)) return;
    }

    // ── Default: crossfade ──
    const showTrend = mode.startsWith('trend');
    const showSplit = mode.startsWith('splitBar');
    const showSankey = mode.startsWith('sankey');

    // Toggle layer visibility
    trendLayer.setVisible(showTrend, modeChanged ? dur : 0);
    splitLayer.setVisible(showSplit, modeChanged ? dur : 0);
    sankeyLayer.setVisible(showSankey, modeChanged ? dur : 0);

    // Update active layer
    if (showTrend) {
      trendLayer.update(state, dur);
    }
    if (showSplit) {
      splitLayer.update(state, dur);
    }
    if (showSankey) {
      sankeyLayer.update(state, dur);
      sankeyLayer.updateOverlay(state, dur);
    }
  }

  // ── Load and display a pair ──
  let isLoading = false;

  async function selectPair(iso3, isic) {
    if (isLoading) return;
    isLoading = true;

    const loadingEl = document.getElementById('loading-indicator');
    if (loadingEl) loadingEl.classList.add('visible');

    try {
      const data = await loadPairData(iso3, isic);
      initWithData(data);

      // Reset to step 0 and re-render
      prevMode = null;
      const initialState = controller.onStepEnter(0);
      render(initialState, 1000);

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error(`Failed to load data for ${iso3}/${isic}:`, err);
    } finally {
      isLoading = false;
      if (loadingEl) loadingEl.classList.remove('visible');
    }
  }

  // ── Initialize with default pair ──
  if (manifest) {
    // Dynamic mode: populate dropdowns and load top pair
    const defaultPair = manifest.pairs[0];
    populateDropdowns(manifest, selectPair);
    await selectPair(defaultPair.iso3, defaultPair.isic);
  } else {
    // Fallback: load static files (old format)
    const [topPair, trend, split, upT1, upT2, upT3, dnT1, dnT2, dnT3] = await Promise.all([
      d3.json('/data/top_pair.json'),
      d3.json('/data/trend_DEU_C29.json'),
      d3.json('/data/split_DEU_C29_2019.json'),
      d3.json('/data/sankey/upstream_t1.json'),
      d3.json('/data/sankey/upstream_t2.json'),
      d3.json('/data/sankey/upstream_t3.json'),
      d3.json('/data/sankey/downstream_t1.json'),
      d3.json('/data/sankey/downstream_t2.json'),
      d3.json('/data/sankey/downstream_t3.json'),
    ]);
    initWithData({ trend, split, upT1, upT2, upT3, dnT1, dnT2, dnT3 });

    controller = createSceneController({
      focusYear: topPair.year,
      maxTierUpstream: 3,
      maxTierDownstream: 3,
    });

    const initialState = controller.onStepEnter(0);
    render(initialState, 1000);
  }

  // ── Scrollama setup ──
  const scroller = scrollama();

  scroller
    .setup({
      step: '#scroll-steps .step',
      offset: 0.5,
      progress: true,
    })
    .onStepEnter(({ index, element }) => {
      d3.selectAll('.step').classed('is-active', false);
      d3.select(element).classed('is-active', true);

      if (controller) {
        const state = controller.onStepEnter(index);
        render(state);
      }
    })
    .onStepProgress(({ index, progress }) => {
      if ((index === 6 || index === 10) && controller) {
        const state = controller.onStepProgress(index, progress);
        render(state, 100);
      }
    });

  // Handle resize
  window.addEventListener('resize', () => {
    scroller.resize();
  });

  // "Explore another pair" link
  const exploreLink = document.querySelector('.explore-link');
  if (exploreLink) {
    exploreLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Focus the country selector
      const sel = document.getElementById('country-select');
      if (sel) setTimeout(() => sel.focus(), 500);
    });
  }
}

main().catch(console.error);
