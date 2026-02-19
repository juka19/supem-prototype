/**
 * StoryboardDrawer: controls the slide-up drawer that wraps the existing
 * scrollytelling storyboard. Opens when a heatmap cell is clicked,
 * can be closed via X button or clicking the handle.
 */

export function createStoryboardDrawer({ onOpen, onClose } = {}) {
  const drawer = document.getElementById('storyboard-drawer');
  const handle = document.getElementById('drawer-handle');
  const closeBtn = document.getElementById('drawer-close-btn');
  const body = drawer?.querySelector('.drawer-body');

  let isOpen = false;

  function open() {
    if (!drawer || isOpen) return;
    isOpen = true;
    drawer.classList.remove('drawer-closed');
    drawer.classList.add('drawer-open');
    document.body.classList.add('drawer-is-open');
    if (onOpen) onOpen();
  }

  function close() {
    if (!drawer || !isOpen) return;
    isOpen = false;
    drawer.classList.remove('drawer-open');
    drawer.classList.add('drawer-closed');
    document.body.classList.remove('drawer-is-open');
    if (onClose) onClose();
  }

  function toggle() {
    isOpen ? close() : open();
  }

  function getIsOpen() {
    return isOpen;
  }

  // ── Event listeners ──
  if (handle) {
    handle.addEventListener('click', toggle);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });
  }
  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  });

  return { open, close, toggle, getIsOpen };
}
