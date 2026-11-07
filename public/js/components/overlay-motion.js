const entrances = new WeakMap();

export function cancelOverlayEntrance(element) {
  entrances.get(element)?.cancel();
  entrances.delete(element);
}

// Start on every actual opening, after hidden/showModal changes. A fade remains
// visible with reduced motion; that preference only removes spatial movement.
export function animateOverlayEntrance(element, { menu = false } = {}) {
  cancelOverlayEntrance(element);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = window.matchMedia('(max-width: 600px)').matches;
  const startTransform = menu
    ? 'translateY(-12px) scale(0.88)'
    : `translateY(${mobile ? 48 : 24}px) scale(0.94)`;
  const frames = reducedMotion
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: startTransform }, { opacity: 1, transform: 'translateY(0) scale(1)' }];
  const animation = element.animate(frames, {
    duration: reducedMotion ? 340 : menu ? 420 : 480,
    easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    fill: 'both',
  });
  entrances.set(element, animation);
  animation.addEventListener('finish', () => {
    if (entrances.get(element) === animation) cancelOverlayEntrance(element);
  }, { once: true });
}
