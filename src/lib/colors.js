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

// Component key → color mapping
export const COMPONENT_COLORS = {
  upstream:    COLORS.upstream,
  domestic_va: COLORS.domestic_va,
  own_direct:  COLORS.own_direct,
  downstream:  COLORS.downstream,
};
