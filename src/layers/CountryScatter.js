/**
 * CountryScatter: D3 scatter plot of countries on the cover gateway.
 * X = S1 production emissions (log scale)
 * Y = S3U − S3D net balance (linear, diverging)
 * Size = total footprint (sqrt scale)
 * Color = net balance (diverging RdBu — red=exporter, blue=importer)
 *
 * Supports scroll-to-zoom and drag-to-pan for exploring overlapping countries.
 */
import * as d3 from 'd3';
import { formatValue } from '../lib/format.js';

export function createCountryScatter(containerSelector, { coverState, toast }) {
  const container = d3.select(containerSelector);
  const svgEl = container.select('#scatter-viz');
  if (svgEl.empty()) return { update() {}, resize() {} };

  const margin = { top: 20, right: 16, bottom: 40, left: 55 };
  let W, H, innerW, innerH;
  let xScale, yScale, xScaleBase, yScaleBase, sizeScale, colorScale;
  let data = null;
  let currentTransform = d3.zoomIdentity;

  // Clip path for zoomed content
  const defs = svgEl.append('defs');
  const clipId = 'scatter-clip-' + Math.random().toString(36).slice(2, 8);
  const clipRect = defs.append('clipPath').attr('id', clipId)
    .append('rect');

  const g = svgEl.append('g');
  const plotG = g.append('g').attr('clip-path', `url(#${clipId})`);
  const xAxisG = g.append('g').attr('class', 'axis x-axis');
  const yAxisG = g.append('g').attr('class', 'axis y-axis');
  const dotsG = plotG.append('g').attr('class', 'scatter-dots');
  const zeroLineG = plotG.append('g').attr('class', 'scatter-zero');
  const labelG = plotG.append('g').attr('class', 'scatter-labels');

  // Axis labels
  const xLabel = g.append('text')
    .attr('class', 'axis-label')
    .attr('text-anchor', 'middle')
    .attr('fill', '#8b8d98')
    .attr('font-size', 10);

  const yLabel = g.append('text')
    .attr('class', 'axis-label')
    .attr('text-anchor', 'middle')
    .attr('fill', '#8b8d98')
    .attr('font-size', 10);

  // Reset zoom button (hidden initially)
  const resetBtn = container.append('div')
    .attr('class', 'scatter-reset-zoom')
    .style('display', 'none')
    .text('Reset zoom')
    .on('click', resetZoom);

  function resize() {
    const rect = container.node().getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    innerW = W - margin.left - margin.right;
    innerH = H - margin.top - margin.bottom;

    svgEl
      .attr('width', W)
      .attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`);

    g.attr('transform', `translate(${margin.left},${margin.top})`);
    clipRect.attr('width', innerW).attr('height', innerH);

    if (data) {
      buildScales(data.points);
      applyZoom(currentTransform);
    }
  }

  function buildScales(points) {
    // X: log scale for S1 production emissions
    const xExtent = d3.extent(points, d => d.x).map(v => Math.max(v, 0.001));
    xScaleBase = d3.scaleLog()
      .domain([xExtent[0] * 0.5, xExtent[1] * 1.5])
      .range([0, innerW])
      .clamp(true);
    xScale = xScaleBase.copy();

    // Y: linear — use actual data extent, keep 0 visible but don't waste space
    const yExtent = d3.extent(points, d => d.y);
    const yMin = Math.min(yExtent[0], 0);           // include 0 at minimum
    const yMax = Math.max(yExtent[1] || 1, 0.1);
    const yPad = (yMax - yMin) * 0.08;              // 8% padding
    yScaleBase = d3.scaleLinear()
      .domain([yMin - yPad, yMax + yPad])
      .range([innerH, 0])
      .nice();
    yScale = yScaleBase.copy();

    // Size: sqrt scale for total emissions — smaller max for less overlap
    const sizeExtent = d3.extent(points, d => d.size);
    sizeScale = d3.scaleSqrt()
      .domain([0, sizeExtent[1]])
      .range([3, 20]);

    // Color: diverging RdBu — red=positive (net exporter), blue=negative (net importer)
    const absMax = Math.max(Math.abs(yMin), Math.abs(yMax));
    colorScale = d3.scaleDiverging()
      .domain([absMax, 0, -absMax])
      .interpolator(d3.interpolateRdBu);
  }

  function drawAxes(dur = 0) {
    const t = dur ? d3.transition().duration(dur) : null;

    const xAx = d3.axisBottom(xScale).ticks(5, '.0s').tickSize(-innerH);
    const yAx = d3.axisLeft(yScale).ticks(6).tickSize(-innerW)
      .tickFormat(d => Math.abs(d) >= 1000 ? d3.format('.0s')(d) : d3.format('.1f')(d));

    if (t) {
      xAxisG.transition(t).attr('transform', `translate(0,${innerH})`).call(xAx);
      yAxisG.transition(t).call(yAx);
    } else {
      xAxisG.attr('transform', `translate(0,${innerH})`).call(xAx);
      yAxisG.call(yAx);
    }

    xAxisG.call(g => g.selectAll('.tick line').attr('stroke-opacity', 0.06));
    yAxisG.call(g => g.selectAll('.tick line').attr('stroke-opacity', 0.06));

    // Zero line
    zeroLineG.selectAll('line').remove();
    zeroLineG.append('line')
      .attr('x1', 0).attr('x2', innerW)
      .attr('y1', yScale(0)).attr('y2', yScale(0))
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-dasharray', '3,2');

    // Axis labels
    xLabel.attr('x', innerW / 2).attr('y', innerH + 32)
      .text('Production emissions, S1 (MtCO₂e)');
    yLabel.attr('transform', `translate(${-42}, ${innerH / 2}) rotate(-90)`)
      .text('Net embodied imports (S3U − S3D)');
  }

  function drawDots(points, dur = 400) {
    const dots = dotsG.selectAll('.scatter-dot')
      .data(points, d => d.iso3);

    dots.exit().transition().duration(dur).attr('r', 0).attr('opacity', 0).remove();

    const enter = dots.enter()
      .append('circle')
      .attr('class', 'scatter-dot')
      .attr('cx', d => xScale(Math.max(d.x, 0.001)))
      .attr('cy', d => yScale(d.y))
      .attr('r', 0)
      .attr('fill', d => colorScale(d.colorValue))
      .attr('fill-opacity', 0.8)
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 0.5);

    enter.merge(dots)
      .on('mouseenter', function (e, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke', '#fff').attr('stroke-width', 1.5);
        coverState.update({ hoveredCountry: d.iso3 });
        toast.show(`${d.name}: S1 = ${formatValue(d.x)}, Net = ${formatValue(d.y)}`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('fill-opacity', 0.8).attr('stroke', 'rgba(255,255,255,0.15)').attr('stroke-width', 0.5);
        coverState.update({ hoveredCountry: null });
        toast.hide();
      })
      .on('click', function (e, d) {
        e.stopPropagation();
        const isAlreadyLocked = coverState.get().lockedCountry === d.iso3;
        coverState.update({ lockedCountry: isAlreadyLocked ? null : d.iso3 });
      })
      .transition().duration(dur)
      .attr('cx', d => xScale(Math.max(d.x, 0.001)))
      .attr('cy', d => yScale(d.y))
      .attr('r', d => sizeScale(d.size))
      .attr('fill', d => colorScale(d.colorValue));

    // Labels for top N that are visible (adapt to zoom level)
    const visiblePoints = points.filter(d => {
      const cx = xScale(Math.max(d.x, 0.001));
      const cy = yScale(d.y);
      return cx >= -20 && cx <= innerW + 20 && cy >= -20 && cy <= innerH + 20;
    });
    const topN = visiblePoints.slice(0, 10);

    const labels = labelG.selectAll('.scatter-country-label')
      .data(topN, d => d.iso3);

    labels.exit().transition().duration(200).attr('opacity', 0).remove();

    labels.enter()
      .append('text')
      .attr('class', 'scatter-country-label')
      .attr('font-size', 8.5)
      .attr('fill', '#8b8d98')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .merge(labels)
      .transition().duration(dur)
      .attr('x', d => xScale(Math.max(d.x, 0.001)))
      .attr('y', d => yScale(d.y) - sizeScale(d.size) - 3)
      .attr('opacity', 0.8)
      .text(d => d.iso3);
  }

  // ── Zoom behaviour ──
  function applyZoom(transform) {
    currentTransform = transform;

    // Rescale axes
    xScale = transform.rescaleX(xScaleBase);
    yScale = transform.rescaleY(yScaleBase);

    drawAxes();
    if (data) drawDots(data.points, 0);

    // Show/hide reset button
    const isZoomed = transform.k !== 1 || transform.x !== 0 || transform.y !== 0;
    resetBtn.style('display', isZoomed ? 'block' : 'none');
  }

  const zoom = d3.zoom()
    .scaleExtent([1, 20])
    .on('zoom', (event) => {
      applyZoom(event.transform);
    });

  function resetZoom() {
    svgEl.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  }

  /** Highlight a country (active = locked or hovered). */
  function highlight(iso3) {
    dotsG.selectAll('.scatter-dot')
      .attr('fill-opacity', d => d.iso3 === iso3 ? 1 : 0.3)
      .attr('stroke', d => d.iso3 === iso3 ? '#fff' : 'rgba(255,255,255,0.08)')
      .attr('stroke-width', d => d.iso3 === iso3 ? 2 : 0.5);
  }

  function clearHighlight() {
    dotsG.selectAll('.scatter-dot')
      .attr('fill-opacity', 0.8)
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 0.5);
  }

  function update(scatterData) {
    data = scatterData;
    resize();
    buildScales(data.points);
    currentTransform = d3.zoomIdentity;
    drawAxes();
    drawDots(data.points);

    // Attach zoom after initial draw
    svgEl.call(zoom)
      .on('dblclick.zoom', () => resetZoom());
  }

  // Resubscribe to state changes for highlight
  coverState.subscribe((s) => {
    if (!data) return;
    if (s.activeCountry) highlight(s.activeCountry);
    else clearHighlight();
  });

  return { update, resize, highlight, clearHighlight };
}
