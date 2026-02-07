/**
 * Scene controller: maps scroll step index + progress to a StoryState object.
 * Single source of truth for the entire visualization.
 */

const MODES = {
  0:  'trend',
  1:  'trend_annotated',
  2:  'trend_zoom_last',
  3:  'splitBar',
  4:  'splitBar_upstreamFocus',
  5:  'sankey_upstream',
  6:  'sankey_upstream',           // progress-driven tier unfolding
  7:  'sankey_upstream_frozen',
  8:  'splitBar_downstreamFocus',
  9:  'sankey_downstream',
  10: 'sankey_downstream',         // progress-driven tier unfolding
  11: 'sankey_downstream_frozen',
};

export function createSceneController({ focusYear = 2019, maxTierUpstream = 3, maxTierDownstream = 3 } = {}) {
  const state = {
    mode: 'trend',
    prevMode: null,
    focusYear,
    highlightYear: null,
    sankeyDirection: null,
    sankeyTier: 1,
    sankeyMaxTier: maxTierUpstream,
    tierAlpha: 0,      // fractional alpha for next tier 0..1
    step: 0,
    progress: 0,
  };

  function onStepEnter(stepIndex) {
    state.prevMode = state.mode;
    state.step = stepIndex;
    state.mode = MODES[stepIndex] || 'trend';
    state.progress = 0;
    state.tierAlpha = 0;

    switch (stepIndex) {
      case 0:
        state.highlightYear = null;
        state.sankeyDirection = null;
        break;
      case 1:
        state.highlightYear = null;
        break;
      case 2:
        state.highlightYear = focusYear;
        break;
      case 3:
        state.highlightYear = focusYear;
        break;
      case 4:
        state.highlightYear = focusYear;
        break;
      case 5:
        state.sankeyDirection = 'upstream';
        state.sankeyTier = 1;
        state.sankeyMaxTier = maxTierUpstream;
        break;
      case 6:
        state.sankeyDirection = 'upstream';
        state.sankeyTier = 1;
        state.sankeyMaxTier = maxTierUpstream;
        break;
      case 7:
        state.sankeyDirection = 'upstream';
        state.sankeyTier = maxTierUpstream;
        state.sankeyMaxTier = maxTierUpstream;
        break;
      case 8:
        state.sankeyDirection = null;
        break;
      case 9:
        state.sankeyDirection = 'downstream';
        state.sankeyTier = 1;
        state.sankeyMaxTier = maxTierDownstream;
        break;
      case 10:
        state.sankeyDirection = 'downstream';
        state.sankeyTier = 1;
        state.sankeyMaxTier = maxTierDownstream;
        break;
      case 11:
        state.sankeyDirection = 'downstream';
        state.sankeyTier = maxTierDownstream;
        state.sankeyMaxTier = maxTierDownstream;
        break;
    }

    return { ...state };
  }

  function onStepProgress(stepIndex, progress) {
    state.step = stepIndex;
    state.progress = progress;

    // Only steps 6 and 10 use progress-based tier unfolding
    if (stepIndex === 6) {
      const maxT = maxTierUpstream;
      const continuous = 1 + progress * (maxT - 1);
      state.sankeyTier = Math.floor(continuous);
      state.tierAlpha = continuous - state.sankeyTier;
      // clamp
      if (state.sankeyTier >= maxT) {
        state.sankeyTier = maxT;
        state.tierAlpha = 0;
      }
    } else if (stepIndex === 10) {
      const maxT = maxTierDownstream;
      const continuous = 1 + progress * (maxT - 1);
      state.sankeyTier = Math.floor(continuous);
      state.tierAlpha = continuous - state.sankeyTier;
      if (state.sankeyTier >= maxT) {
        state.sankeyTier = maxT;
        state.tierAlpha = 0;
      }
    }

    return { ...state };
  }

  function getState() {
    return { ...state };
  }

  return { onStepEnter, onStepProgress, getState };
}
