import * as d3 from 'd3';
import { COLORS, getNodeColor } from '../lib/colors.js';
import { formatValue } from '../lib/format.js';

/**
 * SankeyLayer: renders precomputed tiered Sankey diagrams.
 * Upstream flows right-to-left (root on right, suppliers expand left).
 * Downstream flows left-to-right (root on left, buyers expand right).
 * Supports progressive tier unfolding driven by scroll progress.
 * Nodes are draggable vertically, with link paths following.
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

  // Shared state for drag handler access
  let activeNodeMap = null;
  let activeData = null;
  let activeIsUpstream = false;
  let activeOutgoingSums = null;
  let activeValueToPixel = 1;

  function loadTierData(direction, tier, data) {
    tieredData[direction][tier] = data;
  }

  /** Clear all rendered elements and reset state — call when switching pairs. */
  function clearAll() {
    linksG.selectAll('*').remove();
    nodesG.selectAll('*').remove();
    overlayG.selectAll('*').remove();
    lastDirection = null;
    activeNodeMap = null;
    activeData = null;
    tieredData = { upstream: {}, downstream: {} };
    if (tooltip) tooltip.hide();
  }

  function getRootBounds(direction) {
    const isUp = direction === 'upstream';
    const tierKeys = Object.keys(tieredData[direction] || {}).map(Number);
    if (tierKeys.length === 0) return null;
    const maxTier = Math.max(...tierKeys);
    const data = tieredData[direction][maxTier];
    if (!data) return null;

    const rootNode = data.nodes.find(n => n.tier === 0);
    if (!rootNode) return null;

    const dMaxX = d3.max(data.nodes, n => n.x + n.w) || 1;
    const dMaxY = d3.max(data.nodes, n => n.y + n.h) || 1;
    const gW = innerW * 0.92;
    const sX = gW / dMaxX;

    // Same spread-aware scaling as update()
    const maxTierInData = d3.max(data.nodes, n => n.tier) || 1;
    const baseTierSpread = { 0: 1.0, 1: 1.0, 2: 1.35, 3: 1.5 };
    const worstBaseSpread = baseTierSpread[maxTierInData] ?? 1.5;
    const sY = (innerH * 0.98) / (dMaxY * worstBaseSpread);
    // Independent X/Y scales: prevents outlier countries (e.g. CHN) from
    // squishing the graph when min(sX, sY) collapses to a tiny value.

    const pY = (innerH - dMaxY * worstBaseSpread * sY) / 2;
    const gpW = dMaxX * sX;
    const pXd = 10;
    const pXu = innerW - gpW - 10;

    const pxFn = isUp
      ? v => pXu + (dMaxX - v) * sX
      : v => pXd + v * sX;

    const rx = isUp ? pxFn(rootNode.x) - rootNode.w * sX : pxFn(rootNode.x);

    // Root is tier 0 → spread factor 1.0
    return {
      x: rx,
      y: rootNode.y * 1.0 * sY + pY,
      width: rootNode.w * sX,
      height: Math.max(rootNode.h * sY, 3),
    };
  }

  // ── Rebuild link paths using current node positions (for drag) ──
  function rebuildLinkPaths() {
    if (!activeNodeMap || !activeData) return;

    const isUpstream = activeIsUpstream;

    // Recalculate offsets from scratch
    const srcOffsets = new Map();
    const tgtOffsets = new Map();
    activeData.nodes.forEach(n => {
      srcOffsets.set(n.id, 0);
      tgtOffsets.set(n.id, 0);
    });

    // Re-sort links by target ry
    const sortedLinks = [...activeData.links].sort((a, b) => {
      const ta = activeNodeMap.get(a.target), tb = activeNodeMap.get(b.target);
      if (!ta || !tb) return 0;
      return ta.ry - tb.ry;
    });

    // Rebuild paths
    const pathUpdates = new Map();
    sortedLinks.forEach(link => {
      const src = activeNodeMap.get(link.source);
      const tgt = activeNodeMap.get(link.target);
      if (!src || !tgt) return;

      const strokeW = Math.max(link.value * activeValueToPixel, 1.5);

      const sOff = srcOffsets.get(link.source) || 0;
      const tOff = tgtOffsets.get(link.target) || 0;

      const y0 = src.ry + sOff + strokeW / 2;
      const y1 = tgt.ry + tOff + strokeW / 2;

      srcOffsets.set(link.source, sOff + strokeW);
      tgtOffsets.set(link.target, tOff + strokeW);

      let x0, x1;
      if (isUpstream) {
        x0 = src.rx;
        x1 = tgt.rx + tgt.rw;
      } else {
        x0 = src.rx + src.rw;
        x1 = tgt.rx;
      }
      const mx1 = x0 + (x1 - x0) * 0.4;
      const mx2 = x0 + (x1 - x0) * 0.6;
      const path = `M${x0},${y0} C${mx1},${y0} ${mx2},${y1} ${x1},${y1}`;

      const key = `${link.source}|${link.target}`;
      pathUpdates.set(key, { path, strokeW });
    });

    // Update DOM
    linksG.selectAll('.sankey-link').each(function(d) {
      const upd = pathUpdates.get(d.key);
      if (upd) {
        d.path = upd.path;
        d.strokeW = upd.strokeW;
        d3.select(this)
          .attr('d', upd.path)
          .attr('stroke-width', upd.strokeW);
      }
    });
  }

  function update(state, dur = 700, enterOptions = {}) {
    const { rootPreVisible = false } = enterOptions;
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

    // Always use the max-tier dataset so coordinate scaling stays stable
    // as tiers unfold (each dataset has different extents which would cause
    // the graph to resize if we switched between them).
    const dataKey = maxTierAvailable;
    const data = tieredData[dir][dataKey];
    if (!data) return;

    const rootNode = data.nodes.find(n => n.tier === 0);

    // ── Coordinate scaling ──
    const dataMaxX = d3.max(data.nodes, n => n.x + n.w) || 1;
    const dataMaxY = d3.max(data.nodes, n => n.y + n.h) || 1;
    const graphW = innerW * 0.92;
    const scaleX = graphW / dataMaxX;

    // Tier-dependent vertical spread: tiers 0-1 stay compact,
    // tiers 2+ get progressively more vertical spacing.
    const baseTierSpread = { 0: 1.0, 1: 1.0, 2: 1.35, 3: 1.5 };
    const maxTierInData = d3.max(data.nodes, n => n.tier) || 1;
    const worstBaseSpread = baseTierSpread[maxTierInData] ?? 1.5;

    // Independent X/Y scales: prevents outlier countries (e.g. CHN) from
    // squishing the graph when min(scaleX, scaleY) collapses to a tiny value.
    const scaleY = (innerH * 0.98) / (dataMaxY * worstBaseSpread);

    const getSpread = tier => baseTierSpread[tier] ?? 1.5;
    const spreadMaxY = dataMaxY * worstBaseSpread;
    const padY = (innerH - spreadMaxY * scaleY) / 2;

    // Downstream: graph anchored left, labels to the right
    // Upstream: graph anchored right (mirrored), labels to the left
    const graphPixelW = dataMaxX * scaleX;
    const padXdown = 10;
    const padXup = innerW - graphPixelW - 10;

    const py = (v, tier) => v * getSpread(tier) * scaleY + padY;
    const psX = v => v * scaleX;
    const psY = v => v * scaleY;

    // px maps a data-x to screen-x, mirroring for upstream
    const px = isUpstream
      ? v => padXup + (dataMaxX - v) * scaleX
      : v => padXdown + v * scaleX;

    const t = d3.transition().duration(dur);
    const isScrollDriven = dur <= 150;

    // ── Build node map and scaled node data ──
    const nodeMap = new Map();
    const nodeData = data.nodes.map(n => {
      // For upstream mirror, px(n.x) gives the mirrored position of the
      // node's original left edge, which becomes the right edge after flip.
      // The left edge is then px(n.x) - psX(n.w).
      const rx = isUpstream ? px(n.x) - psX(n.w) : px(n.x);
      const nd = {
        id: n.id,
        label: n.label,
        tier: n.tier,
        group: n.group || 'foreign',
        value: n.value || 0,
        rx,
        ry: py(n.y, n.tier),
        rw: psX(n.w),
        rh: Math.max(psY(n.h), 3),
        origH: n.h,
      };
      nodeMap.set(n.id, nd);
      return nd;
    });

    // ── Store state for drag handler ──
    activeNodeMap = nodeMap;
    activeData = data;
    activeIsUpstream = isUpstream;

    // ── Compute global value-to-pixel scale for consistent link widths ──
    let _bestRef = null;
    for (const n of nodeData) {
      if (n.tier > 0 && n.value > 0 && (!_bestRef || n.value > _bestRef.value)) {
        _bestRef = n;
      }
    }
    activeValueToPixel = _bestRef && _bestRef.value > 0 ? _bestRef.rh / _bestRef.value : 1;

    // ── Compute link stroke widths proportional to value ──
    const outgoingSums = new Map();
    data.links.forEach(l => {
      outgoingSums.set(l.source, (outgoingSums.get(l.source) || 0) + l.value);
    });
    activeOutgoingSums = outgoingSums;

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

      const strokeW = Math.max(link.value * activeValueToPixel, 1.5);

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
        srcGroup: src.group,
      };
    }).filter(Boolean);

    // ── Color helper for links ──
    function linkColor(d) {
      return getNodeColor(d.srcGroup, d.srcTier);
    }

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

    // How much of the edge path should be drawn (0 = hidden, 1 = full)
    function linkDrawFraction(l) {
      if (l.maxTier <= visibleTier) return 1;
      if (l.maxTier === visibleTier + 1 && tierAlpha > 0) return tierAlpha;
      return 0;
    }

    // ── Render links with edge-flow animation ──
    linksG.selectAll('.sankey-link')
      .data(linkData, d => d.key)
      .join(
        enter => {
          const paths = enter.append('path')
            .attr('class', 'sankey-link')
            .attr('d', d => d.path)
            .attr('stroke', d => linkColor(d))
            .attr('stroke-width', d => d.strokeW)
            .attr('stroke-opacity', d => linkStrokeOpacity(d))
            .attr('fill', 'none');

          paths.each(function(d) {
            const totalLength = this.getTotalLength();
            const frac = linkDrawFraction(d);

            if (frac <= 0) {
              d3.select(this)
                .attr('stroke-dasharray', totalLength)
                .attr('stroke-dashoffset', totalLength);
            } else if (frac < 1 || isScrollDriven) {
              d3.select(this)
                .attr('stroke-dasharray', totalLength)
                .attr('stroke-dashoffset', totalLength * (1 - frac));
            } else {
              // Fully visible, animate draw-on
              d3.select(this)
                .attr('stroke-dasharray', totalLength)
                .attr('stroke-dashoffset', totalLength)
                .transition()
                .duration(dur * 0.6)
                .ease(d3.easeLinear)
                .attr('stroke-dashoffset', 0)
                .on('end', function() {
                  d3.select(this)
                    .attr('stroke-dasharray', null)
                    .attr('stroke-dashoffset', null);
                });
            }
          });

          return paths;
        },
        update => {
          update.each(function(d) {
            const el = d3.select(this);
            const totalLength = this.getTotalLength();

            if (isScrollDriven) {
              const frac = linkDrawFraction(d);
              el.attr('d', d.path)
                .attr('stroke', linkColor(d))
                .attr('stroke-width', d.strokeW)
                .attr('stroke-opacity', linkStrokeOpacity(d));
              if (frac < 1) {
                el.attr('stroke-dasharray', totalLength)
                  .attr('stroke-dashoffset', totalLength * (1 - frac));
              } else {
                el.attr('stroke-dasharray', null)
                  .attr('stroke-dashoffset', null);
              }
            } else {
              const frac = linkDrawFraction(d);
              if (frac >= 1) {
                // Fully visible — finish any in-progress draw-on animation
                const currentOffset = parseFloat(el.attr('stroke-dashoffset'));
                if (currentOffset > 0) {
                  // Draw-on still in progress, complete it
                  el.transition(t)
                    .attr('d', d.path)
                    .attr('stroke', linkColor(d))
                    .attr('stroke-width', d.strokeW)
                    .attr('stroke-opacity', linkStrokeOpacity(d))
                    .attr('stroke-dashoffset', 0)
                    .on('end', function() {
                      d3.select(this)
                        .attr('stroke-dasharray', null)
                        .attr('stroke-dashoffset', null);
                    });
                } else {
                  el.transition(t)
                    .attr('d', d.path)
                    .attr('stroke', linkColor(d))
                    .attr('stroke-width', d.strokeW)
                    .attr('stroke-opacity', linkStrokeOpacity(d))
                    .attr('stroke-dasharray', null)
                    .attr('stroke-dashoffset', null);
                }
              } else if (frac > 0) {
                el.transition(t)
                  .attr('d', d.path)
                  .attr('stroke', linkColor(d))
                  .attr('stroke-width', d.strokeW)
                  .attr('stroke-opacity', linkStrokeOpacity(d))
                  .attr('stroke-dashoffset', totalLength * (1 - frac));
              } else {
                el.transition(t)
                  .attr('d', d.path)
                  .attr('stroke', linkColor(d))
                  .attr('stroke-width', d.strokeW)
                  .attr('stroke-opacity', 0);
              }
            }
          });
          return update;
        },
        exit => exit.transition().duration(dur * 0.3).attr('stroke-opacity', 0).remove()
      );

    // ── Render nodes (delayed after edges for step-enter) ──
    const nodeGroups = nodesG.selectAll('.sankey-node')
      .data(nodeData, d => d.id)
      .join(
        enter => {
          const ng = enter.append('g')
            .attr('class', 'sankey-node')
            .attr('opacity', d => {
              if (rootPreVisible && d.tier === 0) return 1;
              return 0;
            });
          ng.append('rect');
          const txt = ng.append('text');
          txt.append('tspan').attr('class', 'label-line1');
          txt.append('tspan').attr('class', 'label-line2');
          txt.append('tspan').attr('class', 'label-line3');
          return ng;
        },
        update => update,
        exit => exit.transition(t).attr('opacity', 0).remove()
      );

    // Animate node opacity: edges first, then nodes
    nodeGroups.each(function(d) {
      const el = d3.select(this);
      const targetOp = nodeOpacity(d);
      const currentOp = parseFloat(el.attr('opacity')) || 0;

      if (isScrollDriven) {
        // Scroll-driven: nodes appear in the last 40% of edge draw
        let nodeAlpha;
        if (d.tier <= visibleTier) {
          nodeAlpha = 1;
        } else if (d.tier === visibleTier + 1 && tierAlpha > 0) {
          nodeAlpha = Math.max(0, (tierAlpha - 0.6) / 0.4);
        } else {
          nodeAlpha = 0;
        }
        el.attr('opacity', nodeAlpha);
      } else if (d.tier > 0 && currentOp === 0 && targetOp > 0) {
        // New node appearing via step-enter: delay until after edges draw
        el.transition()
          .delay(dur * 0.55)
          .duration(dur * 0.35)
          .attr('opacity', targetOp);
      } else {
        el.transition(t).attr('opacity', targetOp);
      }
    });

    // Position rects — set root immediately when rootPreVisible for seamless morph handoff
    nodeGroups.select('rect').each(function(d) {
      const rect = d3.select(this);
      const fill = getNodeColor(d.group, d.tier);
      if (rootPreVisible && d.tier === 0) {
        rect.attr('x', d.rx)
          .attr('y', d.ry)
          .attr('width', d.rw)
          .attr('height', d.rh)
          .attr('fill', fill)
          .attr('rx', 2);
      } else {
        rect.transition(t)
          .attr('x', d.rx)
          .attr('y', d.ry)
          .attr('width', d.rw)
          .attr('height', d.rh)
          .attr('fill', fill)
          .attr('rx', 2);
      }
    });

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
    // For downstream, the LAST visible tier gets left-aligned labels
    //   (placed to the left of the node) to avoid text being clipped.
    const lastVisibleTier = visibleTier + (tierAlpha > 0.3 ? 1 : 0);

    nodeGroups.each(function(d) {
      const textEl = d3.select(this).select('text');
      const showLabel = labelSet.has(d.id);
      const ly = adjustedLabelY.has(d.id) ? adjustedLabelY.get(d.id) : (d.ry + d.rh / 2);
      const fontSize = d.tier === 0 ? 11 : 9;

      let lx, anchor;
      if (isUpstream) {
        lx = d.rx - 6;
        anchor = 'end';
      } else {
        // Downstream: last visible tier labels go LEFT to avoid clipping
        if (d.tier === lastVisibleTier && d.tier > 0) {
          lx = d.rx - 6;
          anchor = 'end';
        } else {
          lx = d.rx + d.rw + 6;
          anchor = 'start';
        }
      }

      textEl
        .attr('text-anchor', anchor)
        .attr('fill', showLabel ? COLORS.text : 'transparent');

      const parts = d.label.split(' \u2013 ');
      const line1 = parts[0] || '';
      // Word-wrap long sector names (split at ~18 chars)
      let line2 = parts.slice(1).join(' \u2013 ') || '';
      let line3 = '';
      if (line2.length > 22) {
        const words = line2.split(' ');
        let row1 = '';
        let splitIdx = 0;
        for (let wi = 0; wi < words.length; wi++) {
          const candidate = row1 ? row1 + ' ' + words[wi] : words[wi];
          if (candidate.length > 20 && row1) { splitIdx = wi; break; }
          row1 = candidate;
          splitIdx = wi + 1;
        }
        if (splitIdx < words.length) {
          line2 = words.slice(0, splitIdx).join(' ');
          line3 = words.slice(splitIdx).join(' ');
        }
      }

      textEl.select('.label-line1')
        .attr('x', lx)
        .attr('y', line2 ? ly - (line3 ? 6 : 1) : ly + 4)
        .attr('font-size', fontSize)
        .attr('font-weight', d.tier === 0 ? 700 : 600)
        .text(showLabel ? line1 : '');

      textEl.select('.label-line2')
        .attr('x', lx)
        .attr('y', line2 ? ly - (line3 ? 6 : 1) + fontSize + 1 : ly)
        .attr('font-size', line2 ? fontSize - 1 : 0)
        .attr('font-weight', 400)
        .attr('fill', showLabel ? COLORS.textMuted : 'transparent')
        .text(showLabel ? line2 : '');

      // Third line for very long names
      let line3El = textEl.select('.label-line3');
      if (line3El.empty()) {
        line3El = textEl.append('tspan').attr('class', 'label-line3');
      }
      line3El
        .attr('x', lx)
        .attr('y', line2 ? ly - (line3 ? 6 : 1) + (fontSize + 1) * 2 : ly)
        .attr('font-size', line3 ? fontSize - 1 : 0)
        .attr('font-weight', 400)
        .attr('fill', showLabel ? COLORS.textMuted : 'transparent')
        .text(showLabel ? line3 : '');
    });

    // ── Drag behavior ──
    const drag = d3.drag()
      .on('start', function() {
        d3.select(this).raise().classed('dragging', true);
      })
      .on('drag', function(event, d) {
        // Clamp within chart bounds
        d.ry = Math.max(0, Math.min(innerH - d.rh, event.y - d.rh / 2));

        // Update node map
        if (activeNodeMap) activeNodeMap.set(d.id, d);

        // Move rect
        d3.select(this).select('rect').attr('y', d.ry);

        // Move label
        const textEl = d3.select(this).select('text');
        const ly = d.ry + d.rh / 2;
        const parts = d.label.split(' \u2013 ');
        const line2 = parts.length > 1;
        textEl.select('.label-line1').attr('y', line2 ? ly - 1 : ly + 4);
        textEl.select('.label-line2').attr('y', line2 ? ly + 9 : ly);

        // Rebuild all link paths
        rebuildLinkPaths();
      })
      .on('end', function() {
        d3.select(this).classed('dragging', false);
      });

    nodeGroups.filter(d => d.tier > 0).call(drag);

    // ── Tooltips ──
    if (tooltip) {
      nodeGroups
        .on('mouseenter', (event, d) => {
          tooltip.show(event, `
            <div class="tt-label">${d.label}</div>
            <div class="tt-value">${formatValue(d.value || 0)} MtCO\u2082e \u2013 Tier ${d.tier}</div>
          `);
        })
        .on('mousemove', (event) => tooltip.move(event))
        .on('mouseleave', () => tooltip.hide());

      linksG.selectAll('.sankey-link')
        .on('mouseenter', (event, d) => {
          tooltip.show(event, `
            <div class="tt-label">${d.srcLabel} \u2192 ${d.tgtLabel}</div>
            <div class="tt-value">${formatValue(d.value)} MtCO\u2082e</div>
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
    // Clear tooltips when hiding the layer
    if (tooltip) tooltip.hide();
  }

  function setVisible(v, dur) {
    if (v) show(dur);
    else hide(dur);
  }

  return { loadTierData, clearAll, update, updateOverlay, show, hide, setVisible, getRootBounds, g };
}
