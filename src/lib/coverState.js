/**
 * CoverState: reactive state store for the cover gateway view.
 * Simple pub/sub pattern — no framework dependency.
 */
export function createCoverState(defaultCountry) {
  const state = {
    hoveredCountry: null,
    lockedCountry: null,
    activeCountry: defaultCountry,
    drawerOpen: false,
    selectedSector: null,
    selectedUseContext: null,
  };

  const listeners = new Set();

  function _recompute() {
    state.activeCountry = state.lockedCountry ?? state.hoveredCountry ?? defaultCountry;
  }

  function update(patch) {
    Object.assign(state, patch);
    _recompute();
    const snapshot = { ...state };
    listeners.forEach(fn => fn(snapshot));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function get() {
    return { ...state };
  }

  return { update, subscribe, get };
}
