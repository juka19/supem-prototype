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
async function loadData() {
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
  return { topPair, trend, split, upT1, upT2, upT3, dnT1, dnT2, dnT3 };
}

// ── Main ──
async function main() {
  const data = await loadData();

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

  // ── Initialize data ──
  trendLayer.init(data.trend);
  splitLayer.init(data.split);

  sankeyLayer.loadTierData('upstream', 1, data.upT1);
  sankeyLayer.loadTierData('upstream', 2, data.upT2);
  sankeyLayer.loadTierData('upstream', 3, data.upT3);
  sankeyLayer.loadTierData('downstream', 1, data.dnT1);
  sankeyLayer.loadTierData('downstream', 2, data.dnT2);
  sankeyLayer.loadTierData('downstream', 3, data.dnT3);

  // ── Scene controller ──
  const controller = createSceneController({
    focusYear: data.topPair.year,
    maxTierUpstream: 3,
    maxTierDownstream: 3,
  });

  // ── Morph transition handlers ──

  function renderMorphA(state, dur) {
    const barBounds = trendLayer.getBarBounds(state.focusYear);
    const targetSegs = splitLayer.getAllSegmentBounds();
    if (!barBounds || !targetSegs) return false;

    morphCtrl.morphTrendToSplit({
      sourceBounds: barBounds,
      segments: data.split.components,
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
    const segKey = direction;
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

  // Initial render
  const initialState = controller.onStepEnter(0);
  render(initialState, 1000);

  // ── Scrollama setup ──
  const scroller = scrollama();

  scroller
    .setup({
      step: '#scroll-steps .step',
      offset: 0.5,
      progress: true,
    })
    .onStepEnter(({ index, element }) => {
      // Mark active step for CSS
      d3.selectAll('.step').classed('is-active', false);
      d3.select(element).classed('is-active', true);

      const state = controller.onStepEnter(index);
      render(state);
    })
    .onStepProgress(({ index, progress }) => {
      // Only steps 6 and 10 use progress
      if (index === 6 || index === 10) {
        const state = controller.onStepProgress(index, progress);
        render(state, 100); // fast transitions for scroll-driven updates
      }
    });

  // Handle resize
  window.addEventListener('resize', () => {
    scroller.resize();
  });
}

main().catch(console.error);
