/**
 * OnboardingTour: guided tooltips that highlight key UI elements.
 * Skippable via "Skip tour" or dismissible step-by-step.
 * Persists dismissal in localStorage so it only shows once.
 */
export function createOnboardingTour() {
  const STORAGE_KEY = 'icio-cover-tour-done';

  // Check if tour was already completed/skipped
  if (localStorage.getItem(STORAGE_KEY)) {
    return { start() {}, isActive() { return false; } };
  }

  const steps = [
    {
      target: '#cover-scatter',
      title: 'Country Scatter Plot',
      text: 'Each bubble is a country. X-axis = direct production emissions (S1), Y-axis = net embodied imports (S3U − S3D). Hover to preview, click to lock a country.',
      position: 'right',
    },
    {
      target: '#cover-heatmap',
      title: 'Domestic Emission Flows',
      text: 'This heatmap shows emission-weighted inter-industry flows within the selected country. Rows = supplying sectors, columns = using sectors.',
      position: 'left',
    },
    {
      target: '#cover-heatmap',
      title: 'Dive into a Sector',
      text: 'Click any cell to open the full supply-chain story for that country–sector pair — tracing upstream and downstream emissions through the global production network.',
      position: 'left',
    },
  ];

  let currentStep = 0;
  let overlayEl = null;
  let tooltipEl = null;
  let spotlightEl = null;
  let active = false;

  function createDOM() {
    // Overlay
    overlayEl = document.createElement('div');
    overlayEl.className = 'tour-overlay';
    document.body.appendChild(overlayEl);

    // Spotlight cutout
    spotlightEl = document.createElement('div');
    spotlightEl.className = 'tour-spotlight';
    document.body.appendChild(spotlightEl);

    // Tooltip
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tour-tooltip';
    document.body.appendChild(tooltipEl);
  }

  function removeDOM() {
    overlayEl?.remove();
    tooltipEl?.remove();
    spotlightEl?.remove();
    overlayEl = null;
    tooltipEl = null;
    spotlightEl = null;
  }

  function showStep(idx) {
    const step = steps[idx];
    if (!step) { finish(); return; }

    const targetEl = document.querySelector(step.target);
    if (!targetEl) { finish(); return; }

    const rect = targetEl.getBoundingClientRect();
    const pad = 8;

    // Position spotlight
    spotlightEl.style.left = `${rect.left - pad}px`;
    spotlightEl.style.top = `${rect.top - pad}px`;
    spotlightEl.style.width = `${rect.width + pad * 2}px`;
    spotlightEl.style.height = `${rect.height + pad * 2}px`;

    // Build tooltip content
    const isLast = idx === steps.length - 1;
    tooltipEl.innerHTML = `
      <div class="tour-tooltip-header">
        <span class="tour-step-counter">${idx + 1} / ${steps.length}</span>
        <button class="tour-skip-btn">Skip tour</button>
      </div>
      <h3 class="tour-title">${step.title}</h3>
      <p class="tour-text">${step.text}</p>
      <div class="tour-actions">
        ${idx > 0 ? '<button class="tour-prev-btn">Back</button>' : '<span></span>'}
        <button class="tour-next-btn">${isLast ? 'Done' : 'Next'}</button>
      </div>
    `;

    // Position tooltip relative to target
    positionTooltip(rect, step.position);

    // Bind events
    tooltipEl.querySelector('.tour-skip-btn').addEventListener('click', finish);
    tooltipEl.querySelector('.tour-next-btn').addEventListener('click', () => {
      if (isLast) finish();
      else { currentStep++; showStep(currentStep); }
    });
    const prevBtn = tooltipEl.querySelector('.tour-prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      currentStep--;
      showStep(currentStep);
    });

    // Click overlay to skip
    overlayEl.addEventListener('click', finish);
  }

  function positionTooltip(rect, position) {
    const ttW = 320;
    tooltipEl.style.width = `${ttW}px`;

    let left, top;

    switch (position) {
      case 'bottom':
        left = rect.left + rect.width / 2 - ttW / 2;
        top = rect.bottom + 16;
        break;
      case 'right':
        left = rect.right + 16;
        top = rect.top + rect.height / 2 - 60;
        break;
      case 'left':
        left = rect.left - ttW - 16;
        top = rect.top + rect.height / 2 - 60;
        break;
      default:
        left = rect.left + rect.width / 2 - ttW / 2;
        top = rect.bottom + 16;
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, window.innerWidth - ttW - 12));
    top = Math.max(12, top);

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function finish() {
    active = false;
    localStorage.setItem(STORAGE_KEY, '1');
    removeDOM();
  }

  function start() {
    // Small delay to let initial render settle
    setTimeout(() => {
      active = true;
      currentStep = 0;
      createDOM();
      showStep(0);
    }, 800);
  }

  function isActive() {
    return active;
  }

  return { start, isActive };
}
