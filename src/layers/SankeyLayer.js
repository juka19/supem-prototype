import * as d3 from 'd3';
import { TIER_COLORS, COLORS } from '../lib/colors.js';
import { formatValue } from '../lib/format.js';

/**
 * SankeyLayer: renders precomputed tiered Sankey diagrams.
 * Upstream flows right-to-left (root on right, suppliers expand left).
 * Downstream flows left-to-right (root on left, buyers expand right).
 * Supports progressive tier unfolding driven by scroll progress.
 */
export function createSankeyLayer(svg, { margin, width, height, tooltip }) {
  const g = svg.append('g')
    .attr('class', 'sankey-layer')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('opacity', 0);

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const linksG = g.append('g').attr('class', 'sankey-links');
  const nodesG = g.append('g').attr('class', 'sankey-nodes');
  const overlayG = g.append('g').attr('class', 'sankey-overlay');

  let tieredData = { upstream: {}, downstream: {} };
  let lastDirection = null;

  function loadTierData(direction, tier, data) {
    tieredData[direction][tier] = data;
  }

  function update(state, dur = 700) {
    const dir = state.sankeyDirection;

    // Clear old elements when switching directions to avoid visual artifacts
    if (dir !== lastDirection) {
      linksG.selectAll('*').remove();
      nodesG.selectAll('*').remove();
      overlayG.selectAll('*').remove();
      lastDirection = dir;
    }
    if (!dir || !tieredData[dir]) return;

    const isUpstream = dir === 'upstream';
    const visibleTier = state.sankeyTier;
    const tierAlpha = state.tierAlpha || 0;
    const maxTierAvailable = Math.max(...Object.keys(tieredData[dir]).map(Number));

    // Pick the dataset that contains all needed tiers
    const dataKey = Math.min(
      Math.max(visibleTier + (tierAlpha > 0 ? 1 : 0), 1),
      maxTierAvailable
    );
    const data = tieredData[dir][dataKey];
    if (!data) return;

    const rootNode = data.nodes.find(n => n.tier === 0);

    // ── Coordinate scaling ──
    // Use 65% of horizontal space for the graph; leave 35% for labels.
    const dataMaxX = d3.max(data.nodes, n => n.x + n.w) || 1;
    const dataMaxY = d3.max(data.nodes, n => n.y + n.h) || 1;
    const graphW = innerW * 0.65;
    const scaleX = graphW / dataMaxX;
    const scaleY = (innerH * 0.88) / dataMaxY;
    const scale = Math.min(scaleX, scaleY);

    const padY = (innerH - dataMaxY * scale) / 2;

    // Downstream: graph anchored left, labels to the right
    // Upstream: graph anchored right (mirrored), labels to the left
    const graphPixelW = dataMaxX * scale;
    const padXdown = 10;
    const padXup = innerW - graphPixelW - 10;

    const py = v => v * scale + padY;
    const ps = v => v * scale;

    // px maps a data-x to screen-x, mirroring for upstream
    const px = isUpstream
      ? v => padXup + (dataMaxX - v) * scale
      : v => padXdown + v * scale;

    const t = d3.transition().duration(dur);
    const tLinks = d3.transition().duration(dur).delay(dur * 0.45);

    // ── Build node map and scaled node data ──
    const nodeMap = new Map();
    const nodeData = data.nodes.map(n => {
      // For upstream mirror, px(n.x) gives the mirrored position of the
      // node's original left edge, which becomes the right edge after flip.
      // The left edge is then px(n.x) - ps(n.w).
      const rx = isUpstream ? px(n.x) - ps(n.w) : px(n.x);
      const nd = {
        id: n.id,
        label: n.label,
        tier: n.tier,
        rx,
        ry: py(n.y),
        rw: ps(n.w),
        rh: Math.max(ps(n.h), 3),
        origH: n.h,
      };
      nodeMap.set(n.id, nd);
      return nd;
    });

    // ── Compute link stroke widths proportional to value ──
    const outgoingSums = new Map();
    data.links.forEach(l => {
      outgoingSums.set(l.source, (outgoingSums.get(l.source) || 0) + l.value);
    });

    // Sort links for consistent Y-offset stacking
    const sortedLinks = [...data.links].sort((a, b) => {
      const ta = nodeMap.get(a.target), tb = nodeMap.get(b.target);
      if (!ta || !tb) return 0;
      return ta.ry - tb.ry;
    });

    // Track cumulative offsets for each node's source and target sides
    const srcOffsets = new Map();
    const tgtOffsets = new Map();
    data.nodes.forEach(n => {
      srcOffsets.set(n.id, 0);
      tgtOffsets.set(n.id, 0);
    });

    const linkData = sortedLinks.map(link => {
      const src = nodeMap.get(link.source);
      const tgt = nodeMap.get(link.target);
      if (!src || !tgt) return null;

      const srcTotal = outgoingSums.get(link.source) || 1;
      const strokeW = Math.max((link.value / srcTotal) * src.rh, 1.5);

      const sOff = srcOffsets.get(link.source);
      const tOff = tgtOffsets.get(link.target);

      const y0 = src.ry + sOff + strokeW / 2;
      const y1 = tgt.ry + tOff + strokeW / 2;

      srcOffsets.set(link.source, sOff + strokeW);
      tgtOffsets.set(link.target, tOff + strokeW);

      // Bezier path: connect the facing edges of source and target
      let x0, x1;
      if (isUpstream) {
        // Source (root) is to the right, target (supplier) is to the left
        x0 = src.rx;            // left edge of source (faces target)
        x1 = tgt.rx + tgt.rw;   // right edge of target (faces source)
      } else {
        x0 = src.rx + src.rw;   // right edge of source
        x1 = tgt.rx;            // left edge of target
      }
      const mx1 = x0 + (x1 - x0) * 0.4;
      const mx2 = x0 + (x1 - x0) * 0.6;
      const path = `M${x0},${y0} C${mx1},${y0} ${mx2},${y1} ${x1},${y1}`;

      const maxT = Math.max(src.tier, tgt.tier);

      return {
        key: `${link.source}|${link.target}`,
        source: link.source,
        target: link.target,
        value: link.value,
        srcLabel: src.label,
        tgtLabel: tgt.label,
        path,
        strokeW,
        maxTier: maxT,
        srcTier: src.tier,
      };
    }).filter(Boolean);

    // ── Visibility functions ──
    function nodeOpacity(n) {
      if (n.tier <= visibleTier) return 1;
      if (n.tier === visibleTier + 1 && tierAlpha > 0) return tierAlpha;
      return 0;
    }

    function linkStrokeOpacity(l) {
      if (l.maxTier <= visibleTier) return 0.4;
      if (l.maxTier === visibleTier + 1 && tierAlpha > 0) return 0.4 * tierAlpha;
      return 0;
    }

    // ── Render links ──
    linksG.selectAll('.sankey-link')
      .data(linkData, d => d.key)
      .join(
        enter => enter.append('path')
          .attr('class', 'sankey-link')
          .attr('d', d => d.path)
          .attr('stroke', d => TIER_COLORS[d.srcTier] || '#666')
          .attr('stroke-width', d => d.strokeW)
          .attr('stroke-opacity', 0)
          .call(el => el.transition(tLinks).attr('stroke-opacity', d => linkStrokeOpacity(d))),
        update => update.call(el => el.transition(tLinks)
          .attr('d', d => d.path)
          .attr('stroke', d => TIER_COLORS[d.srcTier] || '#666')
          .attr('stroke-width', d => d.strokeW)
          .attr('stroke-opacity', d => linkStrokeOpacity(d))
        ),
        exit => exit.transition(tLinks).attr('stroke-opacity', 0).remove()
      );

    // ── Render nodes ──
    const nodeGroups = nodesG.selectAll('.sankey-node')
      .data(nodeData, d => d.id)
      .join(
        enter => {
          const ng = enter.append('g')
            .attr('class', 'sankey-node')
            .attr('opacity', 0);
          ng.append('rect');
          const txt = ng.append('text');
          txt.append('tspan').attr('class', 'label-line1');
          txt.append('tspan').attr('class', 'label-line2');
          return ng;
        },
        update => update,
        exit => exit.transition(t).attr('opacity', 0).remove()
      );

    nodeGroups.transition(t).attr('opacity', d => nodeOpacity(d));

    nodeGroups.select('rect')
      .transition(t)
      .attr('x', d => d.rx)
      .attr('y', d => d.ry)
      .attr('width', d => d.rw)
      .attr('height', d => d.rh)
      .attr('fill', d => TIER_COLORS[d.tier] || '#666')
      .attr('rx', 2);

    // ── Labels: root + top 5 per visible tier ──
    const topPerTier = 5;
    const labelSet = new Set();
    if (rootNode) labelSet.add(rootNode.id);

    for (let ti = 1; ti <= visibleTier + (tierAlpha > 0 ? 1 : 0); ti++) {
      const tierNd = nodeData.filter(n => n.tier === ti);
      tierNd.sort((a, b) => b.rh - a.rh);
      tierNd.slice(0, topPerTier).forEach(n => labelSet.add(n.id));
    }

    // ── De-overlap labels per tier ──
    const labelMinGap = 22; // minimum px between label centers
    const adjustedLabelY = new Map();

    for (let ti = 0; ti <= visibleTier + (tierAlpha > 0 ? 1 : 0); ti++) {
      const tierLabeled = nodeData
        .filter(n => n.tier === ti && labelSet.has(n.id))
        .sort((a, b) => (a.ry + a.rh / 2) - (b.ry + b.rh / 2));

      if (tierLabeled.length <= 1) {
        tierLabeled.forEach(n => adjustedLabelY.set(n.id, n.ry + n.rh / 2));
        continue;
      }

      const pos = tierLabeled.map(n => ({ id: n.id, y: n.ry + n.rh / 2 }));

      // Pass 1: push down to enforce minimum spacing
      for (let i = 1; i < pos.length; i++) {
        const minY = pos[i - 1].y + labelMinGap;
        if (pos[i].y < minY) pos[i].y = minY;
      }

      // Pass 2: pull up from bottom if overflowing the chart
      const maxY = innerH - 10;
      if (pos[pos.length - 1].y > maxY) {
        pos[pos.length - 1].y = maxY;
        for (let i = pos.length - 2; i >= 0; i--) {
          const maxAllowed = pos[i + 1].y - labelMinGap;
          if (pos[i].y > maxAllowed) pos[i].y = maxAllowed;
        }
      }

      pos.forEach(p => adjustedLabelY.set(p.id, p.y));
    }

    // Upstream: labels to the LEFT of nodes (graph is on the right)
    // Downstream: labels to the RIGHT of nodes (graph is on the left)
    nodeGroups.each(function(d) {
      const textEl = d3.select(this).select('text');
      const show = labelSet.has(d.id);
      const ly = adjustedLabelY.has(d.id) ? adjustedLabelY.get(d.id) : (d.ry + d.rh / 2);
      const fontSize = d.tier === 0 ? 12 : 10;

      let lx, anchor;
      if (isUpstream) {
        lx = d.rx - 6;
        anchor = 'end';
      } else {
        lx = d.rx + d.rw + 6;
        anchor = 'start';
      }

      textEl
        .attr('text-anchor', anchor)
        .attr('fill', show ? COLORS.text : 'transparent');

      const parts = d.label.split(' – ');
      const line1 = parts[0] || '';
      const line2 = parts.slice(1).join(' – ') || '';

      textEl.select('.label-line1')
        .attr('x', lx)
        .attr('y', line2 ? ly - 1 : ly + 4)
        .attr('font-size', fontSize)
        .attr('font-weight', d.tier === 0 ? 700 : 600)
        .text(show ? line1 : '');

      textEl.select('.label-line2')
        .attr('x', lx)
        .attr('y', line2 ? ly + fontSize + 1 : ly)
        .attr('font-size', line2 ? fontSize - 1 : 0)
        .attr('font-weight', 400)
        .attr('fill', show ? COLORS.textMuted : 'transparent')
        .text(show ? line2 : '');
    });

    // ── Tooltips ──
    if (tooltip) {
      nodeGroups
        .on('mouseenter', (event, d) => {
          tooltip.show(event, `
            <div class="tt-label">${d.label}</div>
            <div class="tt-value">Tier ${d.tier}</div>
          `);
        })
        .on('mousemove', (event) => tooltip.move(event))
        .on('mouseleave', () => tooltip.hide());

      linksG.selectAll('.sankey-link')
        .on('mouseenter', (event, d) => {
          tooltip.show(event, `
            <div class="tt-label">${d.srcLabel} → ${d.tgtLabel}</div>
            <div class="tt-value">${formatValue(d.value)} MtCO₂e</div>
          `);
        })
        .on('mousemove', (event) => tooltip.move(event))
        .on('mouseleave', () => tooltip.hide());
    }
  }

  function updateOverlay(state, dur = 600) {
    overlayG.selectAll('*').remove();
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

  return { loadTierData, update, updateOverlay, show, hide, setVisible, g };
}
