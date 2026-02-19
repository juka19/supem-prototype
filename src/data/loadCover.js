/**
 * Cover data loaders: fetch scatter and SUT heatmap data for the gateway view.
 * Includes in-memory caching and debounced loading for SUT matrices.
 */
import * as d3 from 'd3';

const API_BASE = '/api/v1';
const LOCAL_BASE = '/data/v1';

async function tryFetch(url) {
  try {
    return await d3.json(url);
  } catch {
    return null;
  }
}

/**
 * Load the country scatter dataset.
 */
export async function loadScatterData() {
  let data = await tryFetch(`${API_BASE}/cover/scatter.json`);
  if (!data) data = await tryFetch(`${LOCAL_BASE}/cover/scatter.json`);
  return data;
}

/**
 * SUT heatmap loader with per-country caching and debounce.
 */
export function createSutLoader() {
  const cache = new Map();
  let debounceTimer = null;
  let currentIso3 = null;

  /**
   * Load a SUT heatmap for a country, debounced.
   * @param {string} iso3
   * @param {function} onData - callback(sutData)
   * @param {function} [onLoading] - callback(iso3) called when fetch starts
   */
  function load(iso3, onData, onLoading) {
    currentIso3 = iso3;

    // Serve from cache immediately if available
    if (cache.has(iso3)) {
      clearTimeout(debounceTimer);
      onData(cache.get(iso3));
      return;
    }

    // Debounce network fetch (150ms)
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (iso3 !== currentIso3) return; // stale request

      if (onLoading) onLoading(iso3);

      let data = await tryFetch(`${API_BASE}/cover/sut_${iso3}.json`);
      if (!data) data = await tryFetch(`${LOCAL_BASE}/cover/sut_${iso3}.json`);

      if (data) {
        cache.set(iso3, data);
      }

      // Only deliver if still the current request
      if (iso3 === currentIso3 && data) {
        onData(data);
      }
    }, 150);
  }

  /**
   * Immediately load (no debounce) — for locked country.
   */
  async function loadImmediate(iso3) {
    if (cache.has(iso3)) return cache.get(iso3);

    let data = await tryFetch(`${API_BASE}/cover/sut_${iso3}.json`);
    if (!data) data = await tryFetch(`${LOCAL_BASE}/cover/sut_${iso3}.json`);

    if (data) cache.set(iso3, data);
    return data;
  }

  return { load, loadImmediate };
}
