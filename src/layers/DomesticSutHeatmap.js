/**
 * DomesticSutHeatmap: canvas-based heatmap of emission-weighted inter-industry
 * flows for a single country. Rows = supplying sectors + IMPORTS,
 * cols = using sectors + EXPORTS.
 *
 * Uses Canvas for the cells (fast for 46×46 grid) and an SVG overlay for
 * axes, labels, and hover interactions.
 */
import * as d3 from 'd3';
import { formatValue } from '../lib/format.js';

export function createDomesticSutHeatmap(containerSelector, { coverState, toast, onCellClick }) {
  const container = d3.select(containerSelector);
  const heatmapContainer = container.select('#heatmap-container');
  const canvas = heatmapContainer.select('#heatmap-canvas');
  const axesSvg = heatmapContainer.select('#heatmap-axes');
  const tooltipEl = heatmapContainer.select('#heatmap-tooltip');
  const countryLabel = container.select('#heatmap-country-label');

  if (canvas.empty() || axesSvg.empty()) return { update() {} };

  const ctx = canvas.node().getContext('2d');
  const margin = { top: 70, right: 8, bottom: 8, left: 90 };

  let data = null;
  let W, H, innerW, innerH, cellW, cellH;
  let colorScale;

  const rowAxisG = axesSvg.append('g').attr('class', 'heatmap-row-axis');
  const colAxisG = axesSvg.append('g').attr('class', 'heatmap-col-axis');

  function resize() {
    const rect = heatmapContainer.node().getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    innerW = W - margin.left - margin.right;
    innerH = H - margin.top - margin.bottom;

    // Canvas pixel scaling for retina
    const dpr = window.devicePixelRatio || 1;
    canvas.attr('width', W * dpr).attr('height', H * dpr);
    canvas.style('width', W + 'px').style('height', H + 'px');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    axesSvg.attr('width', W).attr('height', H);
  }

  function buildColorScale(values) {
    // Flatten and find max (ignoring zeros)
    const flat = values.flat().filter(v => v > 0);
    const maxVal = d3.quantile(flat.sort(d3.ascending), 0.98) || 1;
    colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([0, maxVal]);
  }

  function drawCells(values, rows, cols) {
    const nRows = rows.length;
    const nCols = cols.length;
    cellW = innerW / nCols;
    cellH = innerH / nRows;

    ctx.clearRect(0, 0, W, H);

    // Draw background
    ctx.fillStyle = '#1a1d27';
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < nRows; i++) {
      for (let j = 0; j < nCols; j++) {
        const val = values[i][j];
        const x = margin.left + j * cellW;
        const y = margin.top + i * cellH;

        if (val > 0) {
          ctx.fillStyle = colorScale(val);
        } else {
          ctx.fillStyle = '#14161e';
        }
        ctx.fillRect(x, y, cellW - 0.5, cellH - 0.5);
      }
    }

    // Separator lines for IMPORTS row and EXPORTS col
    const importRowY = margin.top + (nRows - 1) * cellH;
    const exportColX = margin.left + (nCols - 1) * cellW;

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(margin.left, importRowY);
    ctx.lineTo(margin.left + innerW, importRowY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(exportColX, margin.top);
    ctx.lineTo(exportColX, margin.top + innerH);
    ctx.stroke();
  }

  function drawAxes(rows, cols, rowLabels, colLabels) {
    // Truncate labels for display
    const truncate = (s, max = 18) => s.length > max ? s.slice(0, max - 1) + '…' : s;

    // Row labels (left side)
    rowAxisG.selectAll('text').remove();
    rows.forEach((key, i) => {
      rowAxisG.append('text')
        .attr('x', margin.left - 4)
        .attr('y', margin.top + i * cellH + cellH / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', Math.min(9, cellH - 1))
        .attr('fill', key === 'IMPORTS' ? '#e45756' : '#8b8d98')
        .attr('font-weight', key === 'IMPORTS' ? 600 : 400)
        .text(truncate(rowLabels[key] || key, 14));
    });

    // Column labels (top, rotated)
    colAxisG.selectAll('text').remove();
    cols.forEach((key, j) => {
      colAxisG.append('text')
        .attr('transform', `translate(${margin.left + j * cellW + cellW / 2}, ${margin.top - 4}) rotate(-55)`)
        .attr('text-anchor', 'start')
        .attr('font-size', Math.min(9, cellW - 1))
        .attr('fill', key === 'EXPORTS' ? '#72b7b2' : '#8b8d98')
        .attr('font-weight', key === 'EXPORTS' ? 600 : 400)
        .text(truncate(colLabels[key] || key, 14));
    });
  }

  // ── Hover / click via SVG overlay ──
  let hoverRect = axesSvg.append('rect')
    .attr('class', 'heatmap-hover')
    .attr('fill', 'none')
    .attr('stroke', '#fff')
    .attr('stroke-width', 2)
    .attr('pointer-events', 'none')
    .attr('visibility', 'hidden');

  axesSvg.on('mousemove', function (e) {
    if (!data) return;
    const [mx, my] = d3.pointer(e);
    const j = Math.floor((mx - margin.left) / cellW);
    const i = Math.floor((my - margin.top) / cellH);

    if (i < 0 || i >= data.rows.length || j < 0 || j >= data.cols.length) {
      hoverRect.attr('visibility', 'hidden');
      tooltipEl.classed('visible', false);
      return;
    }

    const val = data.values[i][j];
    const rowKey = data.rows[i];
    const colKey = data.cols[j];
    const rowName = data.rowLabels[rowKey] || rowKey;
    const colName = data.colLabels[colKey] || colKey;

    hoverRect
      .attr('x', margin.left + j * cellW)
      .attr('y', margin.top + i * cellH)
      .attr('width', cellW)
      .attr('height', cellH)
      .attr('visibility', 'visible');

    const valText = val > 0 ? formatValue(val) + ' MtCO₂e' : 'No flow';

    tooltipEl
      .classed('visible', true)
      .html(`
        <div class="tt-label">${rowName} → ${colName}</div>
        <div class="tt-value">${valText}</div>
      `);

    // Dynamic positioning: keep tooltip within the heatmap container
    const ttNode = tooltipEl.node();
    const ttW = ttNode.offsetWidth || 160;
    const ttH = ttNode.offsetHeight || 40;
    const containerRect = heatmapContainer.node().getBoundingClientRect();

    let tx = e.offsetX + 14;
    let ty = e.offsetY - 10;

    // Flip horizontally if overflowing right
    if (tx + ttW > containerRect.width - 4) {
      tx = e.offsetX - ttW - 10;
    }
    // Flip vertically if overflowing bottom
    if (ty + ttH > containerRect.height - 4) {
      ty = e.offsetY - ttH - 10;
    }
    // Clamp to top/left edges
    if (tx < 4) tx = 4;
    if (ty < 4) ty = 4;

    tooltipEl
      .style('left', tx + 'px')
      .style('top', ty + 'px');
  });

  axesSvg.on('mouseleave', function () {
    hoverRect.attr('visibility', 'hidden');
    tooltipEl.classed('visible', false);
  });

  axesSvg.on('click', function (e) {
    if (!data) return;
    const [mx, my] = d3.pointer(e);
    const j = Math.floor((mx - margin.left) / cellW);
    const i = Math.floor((my - margin.top) / cellH);

    if (i < 0 || i >= data.rows.length || j < 0 || j >= data.cols.length) return;

    const rowKey = data.rows[i];
    const colKey = data.cols[j];
    // Skip IMPORTS/EXPORTS special rows
    if (rowKey === 'IMPORTS' || colKey === 'EXPORTS') return;

    const val = data.values[i][j];
    if (val <= 0) {
      toast.show('No emission flow for this cell');
      return;
    }

    if (onCellClick) {
      onCellClick({
        iso3: data.country,
        supplyISIC: rowKey,
        useISIC: colKey,
        value: val,
      });
    }
  });

  function update(sutData) {
    data = sutData;
    if (!data) {
      ctx.clearRect(0, 0, W, H);
      countryLabel.text('—');
      return;
    }

    countryLabel.text(data.countryName || data.country);
    resize();
    buildColorScale(data.values);
    drawCells(data.values, data.rows, data.cols);
    drawAxes(data.rows, data.cols, data.rowLabels, data.colLabels);
  }

  return { update, resize };
}
