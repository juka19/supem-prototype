// Color palette constants
export const COLORS = {
  upstream:   '#e45756',
  domestic_va:'#4c78a8',
  own_direct: '#f58518',
  downstream: '#72b7b2',
  bar:        '#4c78a8',
  barDim:     'rgba(76, 120, 168, 0.2)',
  text:       '#e8e8ed',
  textMuted:  '#8b8d98',
  bg:         '#0f1117',
};

// Tier-based Sankey node colors — generic palette, distinct from bar chart
export const TIER_COLORS = [
  '#94a3b8', // tier 0 (root) — slate
  '#a78bfa', // tier 1 (direct) — violet
  '#38bdf8', // tier 2 — sky blue
  '#34d399', // tier 3 — emerald
];

// Group-based node colors for sankey domestic/foreign distinction
const GROUP_COLORS = {
  root:     '#94a3b8',  // slate
  domestic: '#6b7b8d',  // muted blue-gray
  other:    '#4a5568',  // dark gray
};

/**
 * Get node color based on group and tier.
 * Foreign nodes use vivid tier colors; domestic/other are muted.
 */
export function getNodeColor(group, tier) {
  if (GROUP_COLORS[group]) return GROUP_COLORS[group];
  return TIER_COLORS[tier] || '#666';
}

// Component key → color mapping (supports both pipeline keys and legacy keys)
export const COMPONENT_COLORS = {
  // Pipeline keys (scope-based)
  S1:  '#f58518',  // Scope 1 (Direct) — orange
  S2:  '#4c78a8',  // Scope 2 (Electricity & heat) — blue
  S3U: '#e45756',  // Scope 3 Upstream — red
  S3D: '#72b7b2',  // Scope 3 Downstream — teal
  // Legacy / descriptive keys (from static data)
  upstream:    '#e45756',
  domestic_va: '#4c78a8',
  own_direct:  '#f58518',
  downstream:  '#72b7b2',
};

// Map component key to the sankey direction it morphs into
export const SCOPE_TO_DIRECTION = {
  S3U: 'upstream',
  S3D: 'downstream',
  upstream: 'upstream',
  downstream: 'downstream',
};
