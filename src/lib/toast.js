/**
 * Toast: lightweight non-blocking notification.
 * Auto-dismisses after a timeout. Click to dismiss early.
 */
export function createToast() {
  let el = document.getElementById('cover-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cover-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }

  let timer = null;

  function show(message, duration = 3000) {
    clearTimeout(timer);
    el.textContent = message;
    el.classList.add('visible');
    timer = setTimeout(hide, duration);
  }

  function hide() {
    clearTimeout(timer);
    el.classList.remove('visible');
  }

  el.addEventListener('click', hide);

  return { show, hide };
}
