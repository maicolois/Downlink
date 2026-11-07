// Animate layout height so the surrounding content and the auto-sized dialog
// follow the disclosure on every frame, without scaling or stretching text.
export function initializeAnimatedDisclosure(details) {
  const summary = details.querySelector('summary');
  const content = details.querySelector('[data-disclosure-content]');
  const dialog = details.closest('dialog');
  let expanded = details.open;
  let animation = null;

  function reflectState() {
    details.dataset.expanded = String(expanded);
    summary.setAttribute('aria-expanded', String(expanded));
  }

  function finish() {
    animation?.cancel();
    animation = null;
    details.open = expanded;
    details.style.removeProperty('height');
    details.removeAttribute('data-resizing');
    reflectState();
  }

  function setOpen(next) {
    next = Boolean(next);
    if (next === expanded && (animation || details.open === next)) return;
    // Read the current visual height before cancelling an interrupted animation.
    const startHeight = parseFloat(getComputedStyle(details).height);
    animation?.cancel();
    animation = null;
    expanded = next;
    reflectState();
    if (details.hidden || (dialog && !dialog.open)) {
      finish();
      return;
    }

    details.style.height = `${startHeight}px`;
    // Keep the native content rendered until the collapse has finished.
    details.open = true;
    details.dataset.resizing = 'true';
    const style = getComputedStyle(details);
    const borderHeight = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const endHeight = summary.offsetHeight + (expanded ? content.offsetHeight : 0) + borderHeight;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const current = details.animate([
      { height: `${startHeight}px` },
      { height: `${endHeight}px` },
    ], {
      duration: reducedMotion ? 180 : 340,
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      fill: 'both',
    });
    animation = current;
    current.addEventListener('finish', () => {
      if (animation === current) finish();
    }, { once: true });
  }

  summary.addEventListener('click', event => {
    event.preventDefault();
    setOpen(!expanded);
  });
  details.addEventListener('toggle', () => {
    // Keep native/programmatic changes in sync when no transition owns the state.
    if (!animation) {
      expanded = details.open;
      reflectState();
    }
  });
  dialog?.addEventListener('close', finish);
  window.addEventListener('resize', () => { if (animation) finish(); });
  reflectState();
  return { setOpen, finish };
}
