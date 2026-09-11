import { createWaveBackground } from './homepage-background.js';

const PIXEL_BUDGET = 2_400_000;
const TRAIL_POINT_COUNT = 7;
const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform vec2 uPointerPosition;
uniform float uPointerPresence;
uniform vec2 uTrailPositions[7];
uniform vec2 uTrailDirections[7];
uniform float uTrailStrengths[7];
uniform float uTime;

out vec4 outputColor;

float randomValue(vec2 point) {
  vec3 wrapped = fract(vec3(point.xyx) * 0.1031);
  wrapped += dot(wrapped, wrapped.yzx + 33.33);
  return fract((wrapped.x + wrapped.y) * wrapped.z);
}

float smoothNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float top = mix(randomValue(cell), randomValue(cell + vec2(1.0, 0.0)), blend.x);
  float bottom = mix(randomValue(cell + vec2(0.0, 1.0)), randomValue(cell + 1.0), blend.x);
  return mix(top, bottom, blend.y) * 2.0 - 1.0;
}

float terrain(vec2 point) {
  const mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  float value = 0.0;
  float amplitude = 0.56;
  for (int octave = 0; octave < 4; octave += 1) {
    value += smoothNoise(point) * amplitude;
    point = rotation * point * 2.02 + vec2(7.13, -4.71);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 pixel = gl_FragCoord.xy;
  float shortSide = min(uResolution.x, uResolution.y);
  vec2 point = pixel * (4.25 / shortSide);

  vec2 slowPoint = point * 0.55;
  vec2 warp = vec2(
    smoothNoise(slowPoint + vec2(uTime * 0.025, -uTime * 0.016)),
    smoothNoise(slowPoint + vec2(31.4 - uTime * 0.014, 47.8 + uTime * 0.021))
  );
  vec2 samplePoint = point + warp * 0.86 + vec2(uTime * 0.012, -uTime * 0.009);

  vec2 pointerDelta = (pixel - uPointerPosition) / shortSide;
  float pointerDistance = length(pointerDelta);
  float pointerInfluence = (1.0 - smoothstep(0.025, 0.18, pointerDistance)) * uPointerPresence;
  vec2 pointerDirection = pointerDelta / max(pointerDistance, 0.015);
  vec2 displacement = pointerDirection * pointerInfluence * 0.075;
  for (int index = 0; index < 7; index += 1) {
    vec2 trailDelta = (pixel - uTrailPositions[index]) / shortSide;
    float trailDistance = length(trailDelta);
    float influence = (1.0 - smoothstep(0.025, 0.19, trailDistance)) * uTrailStrengths[index];
    vec2 outwardDirection = trailDelta / max(trailDistance, 0.015);
    displacement += outwardDirection * influence * 0.085;
    displacement += uTrailDirections[index] * influence * 0.11;
  }
  float displacementLength = length(displacement);
  if (displacementLength > 0.34) displacement *= 0.34 / displacementLength;
  samplePoint -= displacement;

  float height = terrain(samplePoint);
  float contourScale = 10.5;
  float contourPosition = height * contourScale;
  float distanceToContour = abs(fract(contourPosition + 0.5) - 0.5);
  float antialiasWidth = max(fwidth(contourPosition), 0.0008);
  float line = 1.0 - smoothstep(antialiasWidth * 0.34, antialiasWidth * 1.08, distanceToContour);

  float band = mod(floor((height + 3.0) * contourScale), 3.0);
  float emphasis = 1.0 - step(0.5, band);
  float alpha = line * mix(0.22, 0.32, emphasis);
  vec3 color = mix(vec3(0.54, 0.58, 0.64), vec3(0.65, 0.69, 0.75), emphasis);
  outputColor = vec4(color, alpha);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function createContourBackground(canvas) {
  let gl;
  try {
    gl = canvas?.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
  } catch {
    gl = null;
  }
  if (!gl) return createWaveBackground(canvas);

  const noop = () => {};
  let program = null;
  let positionBuffer = null;
  let uniforms = null;
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let mobile = false;
  let active = false;
  let destroyed = false;
  let contextLost = false;
  let frame = null;
  let lastPaint = null;
  let elapsed = 0;
  let lastTrailTime = -Infinity;
  let lastTrailX = Number.NaN;
  let lastTrailY = Number.NaN;
  const trail = [];
  const trailPositions = new Float32Array(TRAIL_POINT_COUNT * 2);
  const trailDirections = new Float32Array(TRAIL_POINT_COUNT * 2);
  const trailStrengths = new Float32Array(TRAIL_POINT_COUNT);
  const pointer = {
    active: false,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    velocityX: 0,
    velocityY: 0,
    presence: 0,
    moved: false,
    lastMovementAt: -Infinity,
  };

  function setupGraphics() {
    program = createProgram(gl);
    if (!program) return false;
    positionBuffer = gl.createBuffer();
    if (!positionBuffer) return false;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    uniforms = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      pointerPosition: gl.getUniformLocation(program, 'uPointerPosition'),
      pointerPresence: gl.getUniformLocation(program, 'uPointerPresence'),
      trailPositions: gl.getUniformLocation(program, 'uTrailPositions[0]'),
      trailDirections: gl.getUniformLocation(program, 'uTrailDirections[0]'),
      trailStrengths: gl.getUniformLocation(program, 'uTrailStrengths[0]'),
      time: gl.getUniformLocation(program, 'uTime'),
    };
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  if (!setupGraphics()) {
    return { resize: noop, setActive: noop, setPointer: noop, clearPointer: noop, destroy: noop };
  }

  function stop() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    lastPaint = null;
  }

  function clearPointer() {
    pointer.active = false;
    pointer.moved = false;
    lastTrailX = Number.NaN;
    lastTrailY = Number.NaN;
  }

  function clearTrail() {
    trail.length = 0;
    trailStrengths.fill(0);
    pointer.velocityX = 0;
    pointer.velocityY = 0;
    pointer.presence = 0;
    pointer.moved = false;
    pointer.lastMovementAt = -Infinity;
    lastTrailTime = -Infinity;
    lastTrailX = Number.NaN;
    lastTrailY = Number.NaN;
  }

  function updatePointer(delta) {
    if (delta <= 0) return;

    for (let index = trail.length - 1; index >= 0; index -= 1) {
      trail[index].strength *= Math.exp(-2.15 * delta);
      if (trail[index].strength < 0.01) trail.splice(index, 1);
    }

    if (pointer.active) {
      const follow = 1 - Math.exp(-9 * delta);
      const previousX = pointer.x;
      const previousY = pointer.y;
      pointer.x += (pointer.targetX - pointer.x) * follow;
      pointer.y += (pointer.targetY - pointer.y) * follow;
      const instantVelocityX = (pointer.x - previousX) / delta;
      const instantVelocityY = (pointer.y - previousY) / delta;
      const velocityFollow = 1 - Math.exp(-10 * delta);
      pointer.velocityX += (instantVelocityX - pointer.velocityX) * velocityFollow;
      pointer.velocityY += (instantVelocityY - pointer.velocityY) * velocityFollow;
    } else {
      const damping = Math.exp(-8 * delta);
      pointer.velocityX *= damping;
      pointer.velocityY *= damping;
    }
    const targetPresence = pointer.active ? 1 : 0;
    pointer.presence += (targetPresence - pointer.presence) * (1 - Math.exp(-9 * delta));

    const speed = Math.hypot(pointer.velocityX, pointer.velocityY);
    const distanceFromLast = Math.hypot(pointer.x - lastTrailX, pointer.y - lastTrailY);
    const shouldAddPoint = pointer.active
      && pointer.moved
      && speed > 6
      && (!Number.isFinite(distanceFromLast) || distanceFromLast > 12 || elapsed - lastTrailTime > 0.075);
    if (shouldAddPoint) {
      const movementStrength = Math.min(1, speed / 720);
      trail.unshift({
        x: pointer.x,
        y: pointer.y,
        directionX: pointer.velocityX / speed * movementStrength,
        directionY: pointer.velocityY / speed * movementStrength,
        strength: movementStrength,
      });
      if (trail.length > TRAIL_POINT_COUNT) trail.length = TRAIL_POINT_COUNT;
      lastTrailX = pointer.x;
      lastTrailY = pointer.y;
      lastTrailTime = elapsed;
    }
    pointer.moved = false;
  }

  function draw(delta = 0) {
    if (contextLost || !program || !uniforms) return;
    updatePointer(delta);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(
      uniforms.pointerPosition,
      pointer.x * pixelRatio,
      (height - pointer.y) * pixelRatio,
    );
    gl.uniform1f(uniforms.pointerPresence, pointer.presence);
    trailPositions.fill(-10_000);
    trailDirections.fill(0);
    trailStrengths.fill(0);
    for (let index = 0; index < trail.length; index += 1) {
      const point = trail[index];
      trailPositions[index * 2] = point.x * pixelRatio;
      trailPositions[index * 2 + 1] = (height - point.y) * pixelRatio;
      trailDirections[index * 2] = point.directionX;
      trailDirections[index * 2 + 1] = -point.directionY;
      trailStrengths[index] = point.strength;
    }
    gl.uniform2fv(uniforms.trailPositions, trailPositions);
    gl.uniform2fv(uniforms.trailDirections, trailDirections);
    gl.uniform1fv(uniforms.trailStrengths, trailStrengths);
    gl.uniform1f(uniforms.time, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function animate(timestamp) {
    frame = null;
    if (!active || destroyed || contextLost) return;
    const moving = pointer.active && timestamp - pointer.lastMovementAt < 180;
    const interval = 1000 / (moving ? (mobile ? 45 : 60) : (mobile ? 24 : 30));
    if (lastPaint === null || timestamp - lastPaint >= interval - 0.5) {
      const delta = lastPaint === null ? 1 / 60 : Math.min((timestamp - lastPaint) / 1000, 0.05);
      lastPaint = timestamp;
      elapsed += delta;
      draw(delta);
    }
    frame = window.requestAnimationFrame(animate);
  }

  function start() {
    if (active && !destroyed && !contextLost && frame === null) {
      frame = window.requestAnimationFrame(animate);
    }
  }

  function resize() {
    if (destroyed || contextLost) return;
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    mobile = width < 700;
    pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      mobile ? 1.25 : 1.5,
      Math.sqrt(PIXEL_BUDGET / (width * height)),
    );
    canvas.width = Math.max(1, Math.floor(width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    clearTrail();
    draw();
  }

  function setActive(value) {
    if (destroyed || active === Boolean(value)) return;
    active = Boolean(value);
    if (active) start();
    else {
      stop();
      clearPointer();
      clearTrail();
    }
  }

  function setPointer(x, y) {
    if (!active || destroyed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!pointer.active) {
      pointer.x = x;
      pointer.y = y;
      pointer.targetX = x;
      pointer.targetY = y;
      pointer.velocityX = 0;
      pointer.velocityY = 0;
      pointer.moved = false;
      pointer.lastMovementAt = performance.now();
    } else if (Math.hypot(x - pointer.targetX, y - pointer.targetY) > 0.5) {
      pointer.moved = true;
      pointer.lastMovementAt = performance.now();
    }
    pointer.targetX = x;
    pointer.targetY = y;
    pointer.active = true;
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stop();
  }

  function handleContextRestored() {
    if (destroyed) return;
    contextLost = false;
    if (!setupGraphics()) {
      contextLost = true;
      return;
    }
    resize();
    start();
  }

  function destroy() {
    stop();
    active = false;
    destroyed = true;
    clearPointer();
    clearTrail();
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored);
    if (!contextLost) {
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (program) gl.deleteProgram(program);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', handleContextRestored);
  resize();
  return { resize, setActive, setPointer, clearPointer, destroy };
}
