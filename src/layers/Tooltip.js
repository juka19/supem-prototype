/**
 * Simple tooltip controller for the visualization.
 */
export function createTooltip(el) {
  const tooltipEl = typeof el === 'string' ? document.querySelector(el) : el;

  function show(event, html) {
    tooltipEl.innerHTML = html;
    tooltipEl.classList.add('visible');
    move(event);
  }

  function move(event) {
    const x = event.clientX + 14;
    const y = event.clientY - 10;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  }

  function hide() {
    tooltipEl.classList.remove('visible');
  }

  return { show, move, hide };
}
