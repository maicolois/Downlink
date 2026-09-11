const PLATFORMS = ['YouTube', 'Instagram', 'TikTok', 'X', 'Reddit', 'Twitch'];
const HOLD_DURATION = 3000;
const FADE_DURATION = 900;

export function initializeInputPlaceholder(input) {
  const placeholder = input.parentElement.querySelector('.home-controls__placeholder');
  const option = placeholder?.querySelector('.home-controls__placeholder-option');
  const word = option?.querySelector('.home-controls__placeholder-word');
  if (!word) return { sync() {}, destroy() {} };

  let index = 0;
  let timer = null;
  let fade = null;
  let running = false;
  let destroyed = false;

  function stop() {
    running = false;
    window.clearTimeout(timer);
    timer = null;
    fade?.cancel();
    fade = null;
    option.style.opacity = '1';
    placeholder.classList.remove('is-animating');
  }

  function fadeTo(from, to, complete) {
    const duration = FADE_DURATION;
    if (typeof option.animate === 'function') {
      try {
        // Fade the platform and both quotation marks together, keeping the prompt fixed.
        fade = option.animate([{ opacity: from }, { opacity: to }], {
          duration,
          easing: 'cubic-bezier(0.37, 0, 0.63, 1)',
          fill: 'forwards',
        });
      } catch {
        // A visual effect must never prevent the next suggestion from appearing.
        fade = null;
      }
    }

    if (!fade) {
      option.style.opacity = String(to);
      complete();
      return;
    }

    // Advance on our own timer, even if browser animations are paused or disabled.
    timer = window.setTimeout(() => {
      timer = null;
      option.style.opacity = String(to);
      fade.cancel();
      fade = null;
      complete();
    }, duration);
  }

  function schedule() {
    timer = window.setTimeout(() => {
      timer = null;
      // Recheck before changing a suggestion, including programmatic value changes.
      sync();
      if (!running) return;
      fadeTo(1, 0, () => {
        index = (index + 1) % PLATFORMS.length;
        word.textContent = PLATFORMS[index];
        fadeTo(0, 1, schedule);
      });
    }, HOLD_DURATION);
  }

  function sync() {
    if (destroyed) return;
    const visible = input.value.length === 0 && !input.disabled;
    input.classList.toggle('has-animated-placeholder', visible);
    const shouldRotate = visible && !document.hidden;
    placeholder.classList.toggle('is-animating', shouldRotate);
    if (!shouldRotate) {
      stop();
    } else if (!running) {
      running = true;
      schedule();
    }
  }

  // Focus keeps the animation visible until the user actually enters a value.
  // The native placeholder stays intact as a fallback and for CSS button states.
  // Only this decorative layer changes; no values or input events are generated.
  ['focus', 'blur', 'input'].forEach(event => input.addEventListener(event, sync));
  document.addEventListener('visibilitychange', sync);
  sync();

  return {
    sync,
    destroy() {
      destroyed = true;
      stop();
      input.classList.remove('has-animated-placeholder');
      ['focus', 'blur', 'input'].forEach(event => input.removeEventListener(event, sync));
      document.removeEventListener('visibilitychange', sync);
    },
  };
}
