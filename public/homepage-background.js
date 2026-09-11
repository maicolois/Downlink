const TAU = Math.PI * 2;
const PIXEL_BUDGET = 3_000_000;

export function createWaveBackground(canvas) {
  const noop = () => {};
  const fallback = {
    resize: noop,
    setActive: noop,
    setPointer: noop,
    clearPointer: noop,
    destroy: noop,
  };
  let context;
  try {
    context = canvas?.getContext('2d', { alpha: true });
  } catch {
    return fallback;
  }
  if (!context) return fallback;

  let width = 1;
  let height = 1;
  let rows = 30;
  let columns = 64;
  let mobile = false;
  let active = false;
  let destroyed = false;
  let frame = null;
  let lastPaint = null;
  let elapsed = 0;
  let pointsX;
  let pointsY;
  let displacementX;
  let displacementY;
  let velocityX;
  let velocityY;
  const pointer = { active: false, x: 0, y: 0, targetX: 0, targetY: 0 };

  function stop() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    lastPaint = null;
  }

  function clearPointer() {
    pointer.active = false;
  }

  function draw(delta = 0) {
    context.clearRect(0, 0, width, height);
    const time = elapsed;
    const radius = mobile ? 150 : 205;
    const radiusSquared = radius * radius;
    const interaction = pointer.active;
    let dragX = 0;
    let dragY = 0;

    if (interaction && delta > 0) {
      const follow = 1 - Math.exp(-16 * delta);
      const movementX = (pointer.targetX - pointer.x) * follow;
      const movementY = (pointer.targetY - pointer.y) * follow;
      pointer.x += movementX;
      pointer.y += movementY;
      dragX = Math.max(-26, Math.min(26, movementX / delta * 0.022));
      dragY = Math.max(-26, Math.min(26, movementY / delta * 0.022));
    }

    const horizontalStep = (width + 240) / (columns - 1);
    const verticalStep = (height + 240) / (rows - 1);
    const amplitude = mobile ? 0.7 : 1;
    context.lineWidth = 0.85;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (let row = 0; row < rows; row += 1) {
      const offset = row * columns;
      let rowInfluence = 0;
      for (let column = 0; column < columns; column += 1) {
        const index = offset + column;
        const baseX = column * horizontalStep - 120;
        const baseY = row * verticalStep - 120 + amplitude * (
          Math.sin(baseX * 0.0034 + row * 0.24 + time * 0.19) * 38
          + Math.cos(baseX * 0.0017 - row * 0.19 - time * 0.13) * 68
          + Math.sin(baseX * 0.007 + row * 0.41 + time * 0.11) * 10
        );
        let targetX = 0;
        let targetY = 0;

        if (interaction) {
          const distanceX = baseX - pointer.x;
          const distanceY = baseY - pointer.y;
          const distanceSquared = distanceX * distanceX + distanceY * distanceY;
          if (distanceSquared < radiusSquared) {
            const distance = Math.sqrt(distanceSquared);
            const influence = 1 - distance / radius;
            const falloff = influence * influence * (3 - 2 * influence);
            const force = falloff * (mobile ? 45 : 68);
            const normalizer = Math.max(distance, 14);
            targetX = distanceX / normalizer * force + dragX * falloff;
            targetY = distanceY / normalizer * force + dragY * falloff;
            rowInfluence = Math.max(rowInfluence, falloff);
          }
        }

        if (delta > 0) {
          // A damped spring keeps each strand fluid as the cursor moves away.
          velocityX[index] += ((targetX - displacementX[index]) * 95 - velocityX[index] * 17) * delta;
          velocityY[index] += ((targetY - displacementY[index]) * 95 - velocityY[index] * 17) * delta;
          displacementX[index] += velocityX[index] * delta;
          displacementY[index] += velocityY[index] * delta;
        }
        pointsX[index] = baseX + displacementX[index];
        pointsY[index] = baseY + displacementY[index];
      }

      const opacity = 0.13 + (0.5 + Math.sin(row * 0.43) * 0.5) * 0.065 + rowInfluence * 0.12;
      context.strokeStyle = `rgba(149, 165, 187, ${opacity})`;
      context.beginPath();
      context.moveTo(pointsX[offset], pointsY[offset]);
      for (let column = 1; column < columns - 1; column += 1) {
        const index = offset + column;
        context.quadraticCurveTo(
          pointsX[index], pointsY[index],
          (pointsX[index] + pointsX[index + 1]) * 0.5,
          (pointsY[index] + pointsY[index + 1]) * 0.5,
        );
      }
      context.lineTo(pointsX[offset + columns - 1], pointsY[offset + columns - 1]);
      context.stroke();
    }

    // Sparse points travel along the same curved strands, including their deformation.
    for (let row = 1; row < rows - 1; row += 3) {
      const count = mobile ? 2 : 3;
      for (let particle = 0; particle < count; particle += 1) {
        const phase = ((row * 0.271 + particle / count + time * (0.006 + row * 0.00007)) % 1);
        const position = 2 + phase * (columns - 5);
        const column = Math.floor(position);
        const t = position - column;
        const inverseT = 1 - t;
        const index = row * columns + column;
        const x = inverseT * inverseT * (pointsX[index - 1] + pointsX[index]) * 0.5
          + 2 * inverseT * t * pointsX[index]
          + t * t * (pointsX[index] + pointsX[index + 1]) * 0.5;
        const y = inverseT * inverseT * (pointsY[index - 1] + pointsY[index]) * 0.5
          + 2 * inverseT * t * pointsY[index]
          + t * t * (pointsY[index] + pointsY[index + 1]) * 0.5;
        const edgeFade = Math.min(1, phase * 10, (1 - phase) * 10);
        const shimmer = 0.38 + Math.sin(time * 0.6 + row + particle * 2) * 0.08;
        context.fillStyle = `rgba(185, 200, 220, ${shimmer * edgeFade})`;
        context.beginPath();
        context.arc(x, y, particle === 0 ? 1.5 : 1.05, 0, TAU);
        context.fill();
      }
    }
  }

  function animate(timestamp) {
    frame = null;
    if (!active || destroyed) return;
    const interval = 1000 / (mobile ? 30 : 60);
    if (lastPaint === null || timestamp - lastPaint >= interval - 0.5) {
      const delta = lastPaint === null ? 1 / 60 : Math.min((timestamp - lastPaint) / 1000, 0.05);
      lastPaint = timestamp;
      elapsed += delta;
      draw(delta);
    }
    frame = window.requestAnimationFrame(animate);
  }

  function start() {
    if (active && !destroyed && frame === null) {
      frame = window.requestAnimationFrame(animate);
    }
  }

  function resize() {
    if (destroyed) return;
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    mobile = width < 700;
    rows = mobile ? 22 : 30;
    columns = mobile ? 44 : Math.min(72, Math.max(54, Math.ceil(width / 24)));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75, Math.sqrt(PIXEL_BUDGET / (width * height)));
    canvas.width = Math.max(1, Math.floor(width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    const size = rows * columns;
    pointsX = new Float32Array(size);
    pointsY = new Float32Array(size);
    displacementX = new Float32Array(size);
    displacementY = new Float32Array(size);
    velocityX = new Float32Array(size);
    velocityY = new Float32Array(size);
    clearPointer();
    draw();
  }

  function setActive(value) {
    if (destroyed || active === Boolean(value)) return;
    active = Boolean(value);
    if (active) {
      start();
    } else {
      stop();
      clearPointer();
    }
  }

  function setPointer(x, y) {
    if (!active || destroyed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!pointer.active) {
      pointer.x = x;
      pointer.y = y;
    }
    pointer.targetX = x;
    pointer.targetY = y;
    pointer.active = true;
  }

  function destroy() {
    stop();
    active = false;
    destroyed = true;
    clearPointer();
    context.clearRect(0, 0, width, height);
  }

  resize();
  return { resize, setActive, setPointer, clearPointer, destroy };
}
