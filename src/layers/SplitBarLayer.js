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
    let focusKey = null;
    if (state.mode === 'splitBar_upstreamFocus') focusKey = 'upstream';
    if (state.mode === 'splitBar_downstreamFocus') focusKey = 'downstream';

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

    // Labels
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
      .each(function(d) {
        const midY = (yScale(d.y0) + yScale(d.y1)) / 2;
        const labelX = barX + barW + 16;
        const grp = d3.select(this);

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

  return { init, update, show, hide, setVisible, getSegmentBounds, g };
}
