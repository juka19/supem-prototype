import * as d3 from 'd3';
import { COMPONENT_COLORS, COLORS } from '../lib/colors.js';
import { formatValue, formatPct } from '../lib/format.js';

/**
 * SplitBarLayer: renders the decomposed stacked bar for the focus year.
 * Supports: full split, upstream-focus, downstream-focus modes.
 */
export function createSplitBarLayer(svg, { margin, width, height }) {
  const g = svg.append('g')
    .attr('class', 'split-layer')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('opacity', 0);

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const labelsG = g.append('g').attr('class', 'split-labels');
  const barsG = g.append('g').attr('class', 'split-bars');

  let splitData = null;
  let barX, barW, yScale;

  function init(data) {
    splitData = data;
    // Position the split bar in the left third of the drawing area
    // so labels to the right stay within the SVG bounds
    barW = Math.min(innerW * 0.12, 80);
    barX = innerW * 0.15 - barW / 2;

    yScale = d3.scaleLinear()
      .domain([0, data.total])
      .range([innerH, innerH * 0.12]);
  }

  function update(state, dur = 800) {
    if (!splitData) return;
    const t = d3.transition().duration(dur);
    const components = splitData.components;

    // Compute stacked positions
    let cumY = 0;
    const stacked = components.map(c => {
      const item = {
        ...c,
        y0: cumY,
        y1: cumY + c.value,
      };
      cumY += c.value;
      return item;
    });

    // Focus key determines which segment is highlighted
    // Supports both S3U/S3D (pipeline) and upstream/downstream (static) keys
    let focusKey = null;
    if (state.mode === 'splitBar_upstreamFocus') focusKey = 'upstream';
    if (state.mode === 'splitBar_downstreamFocus') focusKey = 'downstream';
    // Check if data uses S3U/S3D keys instead
    if (focusKey && !components.find(c => c.key === focusKey)) {
      if (focusKey === 'upstream') focusKey = 'S3U';
      if (focusKey === 'downstream') focusKey = 'S3D';
    }

    // Bars
    barsG.selectAll('.split-rect')
      .data(stacked, d => d.key)
      .join(
        enter => enter.append('rect')
          .attr('class', 'split-rect')
          .attr('x', barX)
          .attr('width', barW)
          .attr('rx', 3)
          .attr('y', d => yScale(d.y1))
          .attr('height', 0)
          .attr('fill', d => COMPONENT_COLORS[d.key] || '#888')
          .call(el => el.transition(t)
            .attr('height', d => yScale(d.y0) - yScale(d.y1))
          ),
        update => update.call(el => el.transition(t)
          .attr('x', barX)
          .attr('width', barW)
          .attr('y', d => yScale(d.y1))
          .attr('height', d => yScale(d.y0) - yScale(d.y1))
          .attr('fill', d => COMPONENT_COLORS[d.key] || '#888')
        )
      );

    // Opacity for focus mode
    barsG.selectAll('.split-rect')
      .transition(t)
      .attr('opacity', d => {
        if (!focusKey) return 1;
        return d.key === focusKey ? 1 : 0.15;
      });

    // Labels — with de-overlap to prevent text overlap for thin segments
    const labelMinGap = 32; // minimum px between label group centers
    const rawPositions = stacked.map(d => ({
      key: d.key,
      midY: (yScale(d.y0) + yScale(d.y1)) / 2,
    }));

    // Push apart overlapping labels
    for (let i = 1; i < rawPositions.length; i++) {
      const minY = rawPositions[i - 1].midY + labelMinGap;
      if (rawPositions[i].midY < minY) rawPositions[i].midY = minY;
    }
    // Pull back from bottom
    const maxLabelY = innerH - 10;
    if (rawPositions.length > 0 && rawPositions[rawPositions.length - 1].midY > maxLabelY) {
      rawPositions[rawPositions.length - 1].midY = maxLabelY;
      for (let i = rawPositions.length - 2; i >= 0; i--) {
        const cap = rawPositions[i + 1].midY - labelMinGap;
        if (rawPositions[i].midY > cap) rawPositions[i].midY = cap;
      }
    }
    const labelYMap = new Map(rawPositions.map(p => [p.key, p.midY]));

    const labelX = barX + barW + 40; // leave room for elbow leaders

    labelsG.selectAll('.split-label-g')
      .data(stacked, d => d.key)
      .join(
        enter => {
          const lg = enter.append('g').attr('class', 'split-label-g');
          lg.append('text').attr('class', 'split-label-text');
          lg.append('text').attr('class', 'split-label-value');
          return lg;
        }
      )
      .each(function(d, i) {
        const midY = labelYMap.get(d.key);
        const segMidY = (yScale(d.y0) + yScale(d.y1)) / 2;
        const grp = d3.select(this);

        // Draw elbow leader line if label was pushed away from its segment
        let leaderPath = grp.select('.split-leader');
        if (Math.abs(midY - segMidY) > 4) {
          if (leaderPath.empty()) {
            leaderPath = grp.insert('path', ':first-child').attr('class', 'split-leader');
          }
          // Stagger the elbow X so lines from different segments don't overlap
          const elbowX = barX + barW + 8 + i * 5;
          const pathD = `M${barX + barW + 2},${segMidY} L${elbowX},${segMidY} L${elbowX},${midY} L${labelX - 4},${midY}`;
          leaderPath
            .transition(t)
            .attr('d', pathD)
            .attr('fill', 'none')
            .attr('stroke', COMPONENT_COLORS[d.key] || '#888')
            .attr('stroke-width', 1)
            .attr('stroke-opacity', 0.5);
        } else {
          // No displacement — draw a simple horizontal tick
          if (leaderPath.empty()) {
            leaderPath = grp.insert('path', ':first-child').attr('class', 'split-leader');
          }
          const pathD = `M${barX + barW + 2},${segMidY} L${labelX - 4},${midY}`;
          leaderPath
            .transition(t)
            .attr('d', pathD)
            .attr('fill', 'none')
            .attr('stroke', COMPONENT_COLORS[d.key] || '#888')
            .attr('stroke-width', 1)
            .attr('stroke-opacity', 0.35);
        }

        grp.select('.split-label-text')
          .transition(t)
          .attr('x', labelX)
          .attr('y', midY - 2)
          .attr('fill', COMPONENT_COLORS[d.key])
          .attr('font-size', 12)
          .attr('font-weight', 600)
          .text(d.label);

        grp.select('.split-label-value')
          .transition(t)
          .attr('x', labelX)
          .attr('y', midY + 14)
          .attr('fill', COLORS.textMuted)
          .attr('font-size', 11)
          .text(`${formatValue(d.value)} Mt (${formatPct(d.value / splitData.total)})`);

        grp.transition(t)
          .attr('opacity', () => {
            if (!focusKey) return 1;
            return d.key === focusKey ? 1 : 0.2;
          });
      });
  }

  function show(dur = 600) {
    g.transition().duration(dur).attr('opacity', 1);
  }

  function hide(dur = 400) {
    g.transition().duration(dur).attr('opacity', 0);
  }

  function setVisible(v, dur) {
    if (v) show(dur);
    else hide(dur);
  }

  /** Returns the pixel bounds of a specific component segment (for morph transitions). */
  function getSegmentBounds(key) {
    if (!splitData) return null;
    const components = splitData.components;
    let cumY = 0;
    for (const c of components) {
      const y0 = cumY;
      const y1 = cumY + c.value;
      if (c.key === key) {
        return {
          x: barX,
          y: yScale(y1),
          width: barW,
          height: yScale(y0) - yScale(y1),
        };
      }
      cumY += c.value;
    }
    return null;
  }

  function getAllSegmentBounds() {
    if (!splitData) return {};
    const result = {};
    const components = splitData.components;
    let cumY = 0;
    for (const c of components) {
      const y0 = cumY;
      const y1 = cumY + c.value;
      result[c.key] = {
        x: barX,
        y: yScale(y1),
        width: barW,
        height: yScale(y0) - yScale(y1),
      };
      cumY += c.value;
    }
    return result;
  }

  function hideSegment(key) {
    barsG.selectAll('.split-rect')
      .filter(d => d.key === key)
      .attr('opacity', 0);
  }

  return { init, update, show, hide, setVisible, getSegmentBounds, getAllSegmentBounds, hideSegment, g };
}
