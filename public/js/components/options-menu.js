export function initializeOptionsMenu() {
  // Retire local profile data without touching downloads or Instagram sessions.
  try {
    localStorage.removeItem('downlink.profiles.v1');
    localStorage.removeItem('downlink.activeProfileId.v1');
  } catch { /* The menu also works when storage is unavailable. */ }

  const control = document.getElementById('optionsControl');
  const button = document.getElementById('optionsMenuButton');
  const menu = document.getElementById('optionsMenu');
  if (!control || !button || !menu) return;

  const items = () => [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  function close(restoreFocus = false) {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    control.classList.remove('is-open');
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  function open(last = false) {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    control.classList.add('is-open');
    const choices = items();
    (last ? choices.at(-1) : choices[0])?.focus({ preventScroll: true });
  }

  button.addEventListener('click', () => menu.hidden ? open() : close(true));
  button.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    open(event.key === 'ArrowUp');
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('[role="menuitem"]:not(:disabled)')) close();
  });
  control.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(true);
    } else if (menu.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const choices = items();
      const current = choices.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
      choices[next]?.focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!control.contains(event.target)) close();
  });
  document.addEventListener('focusin', event => {
    if (!control.contains(event.target)) close();
  });
}
