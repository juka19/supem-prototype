import * as d3 from 'd3';

const fmt1 = d3.format(',.1f');
const fmt0 = d3.format(',.0f');
const fmt3 = d3.format(',.3f');
const fmtE = d3.format('.2e');
const pctFmt = d3.format('.1%');

export function formatValue(v) {
  if (v >= 100) return fmt0(v);
  if (v >= 0.05) return fmt1(v);
  if (v > 0 && v < 0.05) return fmt3(v) !== '0.000' ? fmt3(v) : fmtE(v);
  return fmt1(v);
}

export function formatPct(v) {
  return pctFmt(v);
}

export function formatLabel(id) {
  // "DEU|C29" → "DEU C29"
  return id.replace('|', ' ');
}
