import * as d3 from 'd3';
import { COLORS, COMPONENT_COLORS } from './colors.js';

/**
 * MorphController: handles cross-layer morph transitions via proxy elements
 * in an overlay <g> that shares the same coordinate space as all layers.
 */
export function createMorphController(svg, { margin }) {
  const morphG = svg.append('g')
    .attr('class', 'morph-layer')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('pointer-events', 'none');

  let activeMorph = null;

  /**
   * Transition A: Trend bar → Split bar
   * Phase 1: subdivide single bar into 4 colored segments
   * Phase 2: tween each segment to its target split bar position
   */
  function morphTrendToSplit({ sourceBounds, segments, targetSegments, dur = 700, onStart, onComplete }) {
    cancel();
    activeMorph = 'trendToSplit';

    if (onStart) onStart();

    const total = segments.reduce((s, c) => s + c.value, 0);

    // Compute stacked subdivisions within the source bar (stacked bottom-up)
    let cumHeight = 0;
    const proxyData = segments.map(seg => {
      const h = sourceBounds.height * (seg.value / total);
      const y = sourceBounds.y + sourceBounds.height - cumHeight - h;
      cumHeight += h;
      return {
        key: seg.key,
        x: sourceBounds.x,
        y,
        width: sourceBounds.width,
        height: h,
        color: COMPONENT_COLORS[seg.key] || '#888',
      };
    });

    // Create proxy rects at source positions with uniform bar color
    const proxies = morphG.selectAll('.morph-rect')
      .data(proxyData, d => d.key)
      .join('rect')
      .attr('class', 'morph-rect')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => d.width)
      .attr('height', d => d.height)
      .attr('fill', COLORS.bar)
      .attr('rx', 2);

    // Phase 1: reveal component colors
    const phase1Dur = dur * 0.3;
    proxies.transition()
      .duration(phase1Dur)
      .attr('fill', d => d.color)
      .on('end', function(d, i) {
        // Only trigger phase 2 from the last proxy's end event
        if (i < proxyData.length - 1) return;

        // Phase 2: tween to target positions
        const phase2Dur = dur * 0.7;
        morphG.selectAll('.morph-rect')
          .transition()
          .duration(phase2Dur)
          .ease(d3.easeCubicInOut)
          .attr('x', d => targetSegments[d.key] ? targetSegments[d.key].x : d.x)
          .attr('y', d => targetSegments[d.key] ? targetSegments[d.key].y : d.y)
          .attr('width', d => targetSegments[d.key] ? targetSegments[d.key].width : d.width)
          .attr('height', d => targetSegments[d.key] ? targetSegments[d.key].height : d.height)
          .attr('rx', 3)
          .on('end', function(d2, j) {
            if (j < proxyData.length - 1) return;
            // Handoff
            morphG.selectAll('*').remove();
            activeMorph = null;
            if (onComplete) onComplete();
          });
      });
  }

  /**
   * Transition B: Split bar segment → Sankey root node
   * Single proxy rect tweens position, size, and color.
   */
  function morphSegmentToSankeyRoot({ segmentBounds, segmentColor, rootBounds, rootColor, dur = 700, onStart, onComplete }) {
    cancel();
    activeMorph = 'segmentToRoot';

    if (onStart) onStart();

    const proxy = morphG.append('rect')
      .attr('class', 'morph-rect')
      .attr('x', segmentBounds.x)
      .attr('y', segmentBounds.y)
      .attr('width', segmentBounds.width)
      .attr('height', segmentBounds.height)
      .attr('fill', segmentColor)
      .attr('rx', 3);

    proxy.transition()
      .duration(dur)
      .ease(d3.easeCubicInOut)
      .attr('x', rootBounds.x)
      .attr('y', rootBounds.y)
      .attr('width', rootBounds.width)
      .attr('height', rootBounds.height)
      .attr('fill', rootColor)
      .attr('rx', 2)
      .on('end', function() {
        morphG.selectAll('*').remove();
        activeMorph = null;
        if (onComplete) onComplete();
      });
  }

  function isActive() {
    return activeMorph !== null;
  }

  function cancel() {
    morphG.selectAll('*').interrupt().remove();
    activeMorph = null;
  }

  return { morphTrendToSplit, morphSegmentToSankeyRoot, isActive, cancel };
}
