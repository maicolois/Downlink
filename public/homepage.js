import { createContourBackground } from './homepage-contour-background.js';

export function initializeHomepage() {
  const resultsPanel = document.querySelector('.results-panel');
  const background = createContourBackground(document.querySelector('.home-background-canvas'));
  const listeners = [];
  let sceneInteractive = false;

  function listen(target, event, handler) {
    if (!target) return;
    target.addEventListener(event, handler, { passive: true });
    listeners.push(() => target.removeEventListener(event, handler));
  }

  function reset() {
    background.clearPointer();
  }

  function syncMotion() {
    const active = !document.hidden
      && !document.body.classList.contains('has-video')
      && !resultsPanel?.classList.contains('visible');
    sceneInteractive = active;
    if (!sceneInteractive) reset();
    background.setActive(active);
  }

  listen(window, 'pointermove', event => {
    if (sceneInteractive && event.isPrimary !== false) {
      background.setPointer(event.clientX, event.clientY);
    }
  });
  listen(window, 'pointerdown', event => {
    if (sceneInteractive && event.isPrimary !== false) {
      background.setPointer(event.clientX, event.clientY);
    }
  });
  listen(window, 'pointerup', event => {
    if (event.pointerType === 'touch') background.clearPointer();
  });
  listen(window, 'pointercancel', () => background.clearPointer());
  listen(document.documentElement, 'pointerleave', reset);
  listen(window, 'blur', reset);
  listen(window, 'resize', () => {
    reset();
    background.resize();
  });
  listen(document, 'visibilitychange', syncMotion);

  const observer = new MutationObserver(syncMotion);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (resultsPanel) observer.observe(resultsPanel, { attributes: true, attributeFilter: ['class'] });
  syncMotion();

  return () => {
    listeners.forEach(remove => remove());
    observer.disconnect();
    reset();
    background.destroy();
  };
}
