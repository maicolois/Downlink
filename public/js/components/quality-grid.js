const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

function createOption({ value, label, desc }, format, selected) {
  const wrapper = document.createElement('div');
  wrapper.className = 'quality-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'quality';
  input.id = `quality-${format}-${value}`;
  input.value = value;
  input.checked = selected;

  const optionLabel = document.createElement('label');
  optionLabel.className = 'quality-option__label';
  optionLabel.htmlFor = input.id;

  const valueElement = document.createElement('span');
  valueElement.className = 'quality-option__value';
  valueElement.textContent = label;
  optionLabel.append(valueElement);

  if (desc) {
    const description = document.createElement('span');
    description.className = 'quality-option__desc';
    description.textContent = desc;
    optionLabel.append(description);
  }

  wrapper.append(input, optionLabel);
  return { wrapper, input, label: optionLabel };
}

/**
 * Owns the quality option DOM for both desktop web and the embedded iOS PWA.
 * Pointer reads are cached and all visual writes are grouped into one frame.
 */
export function createQualityGridController(grid, { onChange } = {}) {
  let inputs = [];
  let labels = [];
  let gridBounds = null;
  let labelBounds = [];
  let geometryDirty = true;
  let pointerFrame = null;
  let pendingPointer = null;
  const finePointer = window.matchMedia?.(FINE_POINTER_QUERY)?.matches ?? true;

  function invalidateGeometry() {
    geometryDirty = true;
  }

  function readGeometry() {
    gridBounds = grid.getBoundingClientRect();
    labelBounds = labels.map(label => label.getBoundingClientRect());
    geometryDirty = false;
  }

  function resetSpotlight() {
    pendingPointer = null;
    if (pointerFrame !== null) window.cancelAnimationFrame(pointerFrame);
    pointerFrame = null;
    grid.style.setProperty('--mouse-x', '50%');
    grid.style.setProperty('--mouse-y', '50%');
    for (const label of labels) {
      label.style.setProperty('--mouse-x', '50%');
      label.style.setProperty('--mouse-y', '50%');
      label.style.setProperty('--spotlight-strength', '0');
    }
  }

  function paintSpotlight() {
    pointerFrame = null;
    if (!pendingPointer || labels.length === 0) return;
    if (geometryDirty || !gridBounds) readGeometry();

    const { x: pointerX, y: pointerY } = pendingPointer;
    const safeGridWidth = Math.max(1, gridBounds.width);
    const safeGridHeight = Math.max(1, gridBounds.height);
    grid.style.setProperty('--mouse-x', `${((pointerX - gridBounds.left) / safeGridWidth) * 100}%`);
    grid.style.setProperty('--mouse-y', `${((pointerY - gridBounds.top) / safeGridHeight) * 100}%`);

    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      const bounds = labelBounds[index];
      const distance = Math.hypot(
        pointerX - (bounds.left + bounds.width / 2),
        pointerY - (bounds.top + bounds.height / 2),
      );
      label.style.setProperty('--mouse-x', `${((pointerX - bounds.left) / Math.max(1, bounds.width)) * 100}%`);
      label.style.setProperty('--mouse-y', `${((pointerY - bounds.top) / Math.max(1, bounds.height)) * 100}%`);
      label.style.setProperty('--spotlight-strength', Math.max(0, 1 - distance / 120).toFixed(3));
    }
  }

  function handlePointerMove(event) {
    pendingPointer = { x: event.clientX, y: event.clientY };
    if (pointerFrame === null) pointerFrame = window.requestAnimationFrame(paintSpotlight);
  }

  function handleChange(event) {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === 'radio' && input.name === 'quality') {
      onChange?.(input.value);
    }
  }

  function clear() {
    resetSpotlight();
    inputs = [];
    labels = [];
    gridBounds = null;
    labelBounds = [];
    geometryDirty = true;
    grid.replaceChildren();
  }

  function render(options, { format }) {
    resetSpotlight();
    const fragment = document.createDocumentFragment();
    const nextInputs = [];
    const nextLabels = [];

    options.forEach((option, index) => {
      const element = createOption(option, format, index === 0);
      fragment.append(element.wrapper);
      nextInputs.push(element.input);
      nextLabels.push(element.label);
    });

    grid.replaceChildren(fragment);
    inputs = nextInputs;
    labels = nextLabels;
    gridBounds = null;
    labelBounds = [];
    geometryDirty = true;
    return inputs[0]?.value ?? null;
  }

  function setDisabled(disabled) {
    for (const input of inputs) input.disabled = disabled;
  }

  function setSelected(value) {
    for (const input of inputs) input.checked = input.value === value;
  }

  grid.addEventListener('change', handleChange);
  if (finePointer) {
    grid.addEventListener('pointermove', handlePointerMove, { passive: true });
    grid.addEventListener('pointerleave', resetSpotlight, { passive: true });
    window.addEventListener('scroll', invalidateGeometry, { passive: true });
    window.addEventListener('resize', invalidateGeometry, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(invalidateGeometry).observe(grid);
  }

  return { clear, render, setDisabled, setSelected, invalidateGeometry };
}
