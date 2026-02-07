import * as d3 from 'd3';
import { COLORS } from '../lib/colors.js';
import { formatValue } from '../lib/format.js';

/**
 * TrendBarLayer: renders a bar chart of emissions over time.
 * Supports: full trend, annotation, zoom-to-last-year.
 */
export function createTrendBarLayer(svg, { margin, width, height }) {
  const g = svg.append('g')
    .attr('class', 'trend-layer')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = d3.scaleBand().padding(0.25);
  const yScale = d3.scaleLinear();

  const xAxisG = g.append('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerH})`);

  const yAxisG = g.append('g')
    .attr('class', 'axis y-axis');

  const barsG = g.append('g').attr('class', 'bars');
  const annotG = g.append('g').attr('class', 'trend-annotations');

  let currentData = null;

  function init(trendData) {
    currentData = trendData;
    const years = trendData.series.map(d => d.year);
    const maxVal = d3.max(trendData.series, d => d.value) * 1.15;

    // Keep bars in the left portion so annotations don't overflow the right edge
    xScale.domain(years).range([0, innerW * 0.65]);
    yScale.domain([0, maxVal]).range([innerH, 0]);

    xAxisG.call(d3.axisBottom(xScale).tickFormat(d3.format('d')));
    yAxisG.call(d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d}`));

    // Add y-axis label
    yAxisG.selectAll('.y-label').data([0]).join('text')
      .attr('class', 'y-label')
      .attr('transform', 'rotate(-90)')
      .attr('y', -45)
      .attr('x', -innerH / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', COLORS.textMuted)
      .attr('font-size', 11)
      .text(trendData.unit);
  }

  function update(state, dur = 800) {
    if (!currentData) return;
    const t = d3.transition().duration(dur);
    const series = currentData.series;

    // Bars
    barsG.selectAll('.bar-rect')
      .data(series, d => d.year)
      .join(
        enter => enter.append('rect')
          .attr('class', 'bar-rect')
          .attr('x', d => xScale(d.year))
          .attr('width', xScale.bandwidth())
          .attr('y', innerH)
          .attr('height', 0)
          .attr('fill', COLORS.bar)
          .attr('rx', 2)
          .call(el => el.transition(t)
            .attr('y', d => yScale(d.value))
            .attr('height', d => innerH - yScale(d.value))
          ),
        update => update.call(el => el.transition(t)
          .attr('x', d => xScale(d.year))
          .attr('width', xScale.bandwidth())
          .attr('y', d => yScale(d.value))
          .attr('height', d => innerH - yScale(d.value))
        ),
        exit => exit.transition(t).attr('height', 0).attr('y', innerH).remove()
      );

    // Opacity based on highlight
    if (state.highlightYear != null) {
      barsG.selectAll('.bar-rect')
        .transition(t)
        .attr('opacity', d => d.year === state.highlightYear ? 1 : 0.15);
    } else {
      barsG.selectAll('.bar-rect')
        .transition(t)
        .attr('opacity', 1);
    }

    // Annotations
    updateAnnotations(state, t);
  }

  function updateAnnotations(state, t) {
    annotG.selectAll('*').remove();

    if (state.mode === 'trend_annotated' || state.mode === 'trend_zoom_last') {
      const lastPoint = currentData.series[currentData.series.length - 1];

      // Value label on last bar
      annotG.append('text')
        .attr('class', 'annotation-text')
        .attr('x', xScale(lastPoint.year) + xScale.bandwidth() / 2)
        .attr('y', yScale(lastPoint.value) - 12)
        .attr('text-anchor', 'middle')
        .attr('font-size', 14)
        .attr('font-weight', 700)
        .attr('fill', COLORS.text)
        .text(`${formatValue(lastPoint.value)} ${currentData.unit}`)
        .attr('opacity', 0)
        .transition(t)
        .attr('opacity', 1);
    }
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

  function getBarBounds(year) {
    if (!currentData) return null;
    const d = currentData.series.find(s => s.year === year);
    if (!d) return null;
    return {
      x: xScale(d.year),
      y: yScale(d.value),
      width: xScale.bandwidth(),
      height: innerH - yScale(d.value),
    };
  }

  function hideBar(year) {
    barsG.selectAll('.bar-rect')
      .filter(d => d.year === year)
      .attr('opacity', 0);
  }

  return { init, update, show, hide, setVisible, getBarBounds, hideBar, g, xScale, yScale, innerW, innerH };
}
