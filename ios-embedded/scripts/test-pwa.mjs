// Browser integration tests against a synthetic API. No third-party downloads
// or personal accounts. The UI and service worker are the production files.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium, webkit, devices } from 'playwright-core';
import { MP3_QUALITIES } from '@/shared/mp3-qualities.js';
import { mountIosEmbeddedAssets } from '@/ios-embedded/server.js';
import { createHttpCompression } from '@/server/middleware/http-compression.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'artifacts/ios-embedded');
await fs.mkdir(output, { recursive: true });
const app = express();
app.use(createHttpCompression());
app.use(express.json());
mountIosEmbeddedAssets(app);
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
const jobs = new Map();
let starts = 0;
let files = 0;
let lastJob;
let sessionReads = 0;
app.get('/api/instagram/session', (_req, res) => {
  sessionReads += 1;
  res.json({ available: false, connected: false, pending: false });
});
app.post('/api/info', (req, res) => res.json({
  url: req.body.url, platform: 'youtube', title: 'Vídeo de prueba · Downlink', channel: 'Prueba local',
  thumbnail: `${base}/assets/icons/favicon.svg`, duration: 60, view_count: 1234,
  videoFormats: [{ height: 720, label: '720p' }, { height: 480, label: '480p' }], audioQualities: MP3_QUALITIES,
}));
app.post('/api/download', (req, res) => {
  starts += 1;
  const jobId = randomUUID();
  lastJob = { status: 'downloading', format: req.body.format, filename: `downlink.${req.body.format}`,
    progress: '40%', progressDetail: 'Preparando archivo de prueba' };
  jobs.set(jobId, lastJob);
  res.json({ jobId });
});
app.get('/api/status/:id', (req, res) => {
  if (!jobs.has(req.params.id)) return res.status(404).json({ error: 'Archivo caducado' });
  res.set('Cache-Control', 'no-store').json(jobs.get(req.params.id));
});
app.post('/api/cancel/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) job.status = 'cancelled';
  res.json({ status: 'cancelled' });
});
app.get('/api/file/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.sendStatus(404);
  files += 1;
  res.set('Cache-Control', 'private, no-store');
  res.attachment(job.filename);
  res.sendFile(path.join(root, 'android/app/src/androidTest/assets/sample.mp4'));
});
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const compressedShell = await fetch(`${base}/css/main.css`, {
  headers: { 'Accept-Encoding': 'gzip' },
});
assert.equal(compressedShell.headers.get('content-encoding'), 'gzip', 'Shared web assets should be compressed');
const mediaProbeId = randomUUID();
jobs.set(mediaProbeId, { status: 'ready', format: 'mp4', filename: 'downlink.mp4' });
const mediaProbe = await fetch(`${base}/api/file/${mediaProbeId}`, {
  headers: { 'Accept-Encoding': 'gzip' },
});
assert.equal(mediaProbe.headers.get('content-encoding'), null, 'Prepared media must never be recompressed');
assert.ok((await mediaProbe.arrayBuffer()).byteLength > 100_000, 'The uncompressed media response stays intact');
jobs.delete(mediaProbeId);
files = 0;
const waitUntil = async condition => {
  for (let i = 0; i < 100; i += 1) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for browser behavior');
};

async function prepare(context, { fallback = false } = {}) {
  await context.addInitScript(() => {
    // Read the real framebuffer during its first draw. CSS color assertions
    // alone cannot catch a transparent or incorrectly composited WebGL canvas.
    const pointerPresenceUniforms = new WeakSet();
    const getUniformLocation = WebGL2RenderingContext.prototype.getUniformLocation;
    WebGL2RenderingContext.prototype.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      if (location && name === 'uPointerPresence') pointerPresenceUniforms.add(location);
      return location;
    };
    const uniform1f = WebGL2RenderingContext.prototype.uniform1f;
    WebGL2RenderingContext.prototype.uniform1f = function (location, value) {
      if (pointerPresenceUniforms.has(location)) window.backgroundPointerPresence = value;
      return uniform1f.call(this, location, value);
    };
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      draw.apply(this, args);
      if (this.canvas.classList.contains('home-background-canvas')) {
        window.backgroundDrawCount = (window.backgroundDrawCount || 0) + 1;
      }
      if (window.backgroundPixels || !this.canvas.classList.contains('home-background-canvas')) return;
      const pixels = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
      this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, pixels);
      let black = 0, opaque = 0, light = 0, peak = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === 8 && pixels[i + 1] === 9 && pixels[i + 2] === 11) black += 1;
        if (pixels[i + 3] === 255) opaque += 1;
        light += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
        peak = Math.max(peak, pixels[i + 2]);
      }
      const count = pixels.length / 4;
      window.backgroundPixels = { black: black / count, opaque: opaque / count, light: light / count, peak };
    };
  });
  const page = await context.newPage();
  const errors = [];
  const diagnostics = { networkOutage: false };
  page.on('pageerror', error => {
    // WebKit reports a native access-control diagnostic even for caught,
    // same-origin fetch failures during the deliberate network outage.
    if (diagnostics.networkOutage && /\/api\/(?:status\/|instagram\/session).*due to access control checks\.$/.test(error.message)) return;
    errors.push(error.message);
  });
  page.setDefaultTimeout(15_000);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  if (fallback) {
    await page.locator('.home-background-canvas--static').waitFor();
    const style = await page.locator('.home-background-canvas--static').evaluate(e => {
      const css = getComputedStyle(e);
      return { image: css.backgroundImage, base: css.backgroundColor };
    });
    assert.match(style.image, /contours-fallback\.png/);
    assert.equal(style.base, 'rgb(8, 9, 11)');
  } else {
    await page.waitForFunction(() => Boolean(window.backgroundPixels));
    const pixels = await page.evaluate(() => window.backgroundPixels);
    assert.equal(pixels.opaque, 1, 'The renderer must paint an opaque background on every device');
    assert.ok(pixels.black > 0.5, 'Most of the backdrop must retain the exact desktop black');
    assert.ok(pixels.light >= 9 && pixels.light < 15, 'Contours must not wash out the background');
    assert.ok(pixels.peak > 11 && pixels.peak < 80, 'The dark contours must still be drawn');
    const initialDraws = await page.evaluate(() => window.backgroundDrawCount);
    await page.waitForFunction(
      draws => window.backgroundDrawCount > draws,
      initialDraws,
      { timeout: 2_000 }
    );
  }
  return { page, errors, diagnostics };
}

async function overlayEntranceChecks(browser, name) {
  // Observe real frames without seeking/finishing animations or disabling them
  // for screenshots. In reduced motion the entrance must still fade in.
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const context = await browser.newContext({
      viewport: { width: reducedMotion === 'reduce' ? 390 : 1440, height: 900 },
      reducedMotion, serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      await page.goto(base);
      await page.waitForFunction(() => document.querySelector('#instagramAccountButton').dataset.connectionState !== 'loading');
      const observe = async (triggerId, targetId) => {
        const result = await page.evaluate(async ({ triggerId, targetId }) => {
          document.getElementById(triggerId).click();
          const element = document.getElementById(targetId);
          const entrance = element.getAnimations().find(animation => animation.effect.target === element);
          const frames = [];
          let sampling = true;
          const sample = () => {
            const style = getComputedStyle(element);
            frames.push({ opacity: Number(style.opacity), transform: style.transform });
          };
          sample();
          if (!entrance) return { frames, animated: false };
          const collect = () => {
            if (!sampling) return;
            sample();
            requestAnimationFrame(collect);
          };
          requestAnimationFrame(collect);
          await entrance.finished;
          sampling = false;
          sample();
          const button = document.getElementById('optionsMenuButton');
          return { frames, animated: true, buttonTransform: getComputedStyle(button).transform,
            dotsTransform: getComputedStyle(button.querySelector('svg')).transform };
        }, { triggerId, targetId });
        assert.ok(result.animated, `${name} ${reducedMotion}: ${targetId} animates on open`);
        assert.equal(result.frames[0].opacity, 0, 'No fully-visible first frame');
        assert.ok(result.frames.some(frame => frame.opacity > 0 && frame.opacity < 1), 'The browser paints intermediate frames');
        assert.equal(result.frames.at(-1).opacity, 1, 'Opening finishes fully visible');
        assert.equal(result.buttonTransform, 'none', 'The three-dot button stays still');
        assert.equal(result.dotsTransform, 'none', 'The three dots stay still');
        if (reducedMotion === 'reduce') {
          assert.ok(result.frames.every(frame => frame.transform === 'none'), 'Reduced motion uses opacity only');
        } else {
          assert.notEqual(result.frames[0].transform, result.frames.at(-1).transform);
        }
      };
      for (const platform of ['instagram', 'youtube', 'instagram']) {
        await observe('optionsMenuButton', 'optionsMenu');
        await observe(`${platform}AccountButton`, `${platform}AccountDialog`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog[open]') && document.activeElement.id === 'optionsMenuButton');
      }
      // Closing before the first frame must not leave an old animation behind.
      await page.evaluate(() => {
        document.getElementById('optionsMenuButton').click();
        document.getElementById('optionsMenuButton').click();
      });
      assert.equal(await page.locator('#optionsMenu').isVisible(), false);
      await observe('optionsMenuButton', 'optionsMenu');
      await page.keyboard.press('Escape');
    } finally {
      await context.close();
    }
  }
  console.log(`${name}: actual overlay entrance frames, repeat opens, static dots and reduced-motion fades passed`);
}

async function disclosureResizeChecks(browser, name) {
  for (const [width, height, reducedMotion] of [[1440, 1000, 'no-preference'], [390, 844, 'no-preference'], [320, 568, 'reduce']]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(base);
      await page.locator('#optionsMenuButton').click();
      await page.locator('#youtubeAccountButton').click();
      await page.waitForFunction(() => document.getElementById('youtubeAccountDialog').getAnimations().length === 0);
      for (const expanding of [true, false]) {
        const result = await page.evaluate(async () => {
          const details = document.getElementById('youtubeBridgeHelp');
          const dialog = document.getElementById('youtubeAccountDialog');
          const actions = dialog.querySelector('.instagram-dialog__actions');
          const measure = () => ({
            help: details.getBoundingClientRect().height,
            modal: dialog.getBoundingClientRect().height,
            top: dialog.getBoundingClientRect().top,
            actions: actions.offsetTop,
          });
          const before = measure();
          details.querySelector('summary').click();
          const frames = [measure()];
          const animation = details.getAnimations().find(value => value.effect.target === details);
          if (!animation) return { animated: false };
          let sampling = true;
          const sample = () => {
            if (!sampling) return;
            frames.push(measure());
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
          await animation.finished;
          sampling = false;
          await new Promise(requestAnimationFrame);
          frames.push(measure());
          return { animated: true, before, frames, open: details.open,
            inlineHeight: details.style.height, expanded: details.querySelector('summary').getAttribute('aria-expanded') };
        });
        assert.ok(result.animated, `${name} ${width}: disclosure animates`);
        const first = result.frames[0], last = result.frames.at(-1);
        assert.ok(Math.abs(first.help - result.before.help) < 1, 'Disclosure starts at its current height');
        assert.ok(Math.abs(first.modal - result.before.modal) < 1, 'The modal does not jump on the first frame');
        assert.ok(Math.abs(first.top - result.before.top) < 1, 'The modal starts at its current position');
        assert.ok((last.help - first.help) * (expanding ? 1 : -1) > 40);
        assert.ok(result.frames.some(frame => frame.help > Math.min(first.help, last.help) + 1
          && frame.help < Math.max(first.help, last.help) - 1), 'Disclosure height has actual intermediate frames');
        for (const frame of result.frames) {
          assert.ok(Math.abs((frame.actions - first.actions) - (frame.help - first.help)) < 2,
            'The action buttons follow the disclosure in layout on every frame');
          assert.ok(frame.top >= -1 && frame.top + frame.modal <= height + 1, 'Modal stays inside the viewport');
        }
        if (Math.abs(last.modal - first.modal) > 4) {
          assert.ok(result.frames.some(frame => frame.modal > Math.min(first.modal, last.modal) + 1
            && frame.modal < Math.max(first.modal, last.modal) - 1), 'Modal height grows/shrinks continuously');
        }
        assert.equal(result.open, expanding);
        assert.equal(result.expanded, String(expanding));
        assert.equal(result.inlineHeight, '', 'Natural height is restored after the transition');
      }
      const reversal = await page.evaluate(async () => {
        const details = document.getElementById('youtubeBridgeHelp');
        const summary = details.querySelector('summary');
        summary.click();
        await new Promise(resolve => setTimeout(resolve, 70));
        const before = details.getBoundingClientRect().height;
        summary.click();
        const after = details.getBoundingClientRect().height;
        await details.getAnimations().find(value => value.effect.target === details).finished;
        await new Promise(requestAnimationFrame);
        return { before, after, open: details.open, inlineHeight: details.style.height };
      });
      assert.ok(Math.abs(reversal.before - reversal.after) < 1, 'Rapid clicks reverse from the current height');
      assert.equal(reversal.open, false);
      assert.equal(reversal.inlineHeight, '');
      await page.locator('#youtubeBridgeHelp summary').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('youtubeBridgeHelp').open
        && !document.getElementById('youtubeBridgeHelp').hasAttribute('data-resizing'));
      await page.keyboard.press('Space');
      await page.waitForFunction(() => !document.getElementById('youtubeBridgeHelp').open);
      await page.evaluate(() => {
        document.querySelector('#youtubeBridgeHelp summary').click();
        document.getElementById('youtubeAccountClose').click();
      });
      await page.waitForFunction(() => !document.getElementById('youtubeAccountDialog').open
        && !document.getElementById('youtubeBridgeHelp').hasAttribute('data-resizing'));
      assert.equal(await page.locator('#youtubeBridgeHelp').evaluate(element => element.style.height), '');
    } finally {
      await context.close();
    }
  }
  console.log(`${name}: disclosure/modal resize, content flow, reversal, keyboard and small screens passed`);
}

async function menuChecks(page, name) {
  const trigger = page.locator('#optionsMenuButton');
  const menu = page.locator('#optionsMenu');
  const youtube = page.locator('#youtubeAccountButton');
  const instagram = page.locator('#instagramAccountButton');
  assert.equal(await page.locator('#profileGate, #profileControl, #pwaInstallButton').count(), 0);
  assert.equal(await page.locator('#urlInput').isEnabled(), true, 'Fresh visitors enter directly');
  assert.equal(await trigger.locator('circle').count(), 3);
  await trigger.click();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await menu.isVisible(), true);
  assert.equal(await menu.locator('[role="menuitem"]').count(), 2);
  assert.match(await youtube.innerText(), /Sesión de YouTube/);
  assert.match(await instagram.innerText(), /Conectar Instagram/);
  await page.screenshot({ path: path.join(output, `${name}-menu.png`), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await youtube.evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#youtubeAccountDialog').evaluate(e => e.open), true);
  assert.match(await page.locator('#youtubeBrowserEnable').innerText(), /Conectar YouTube/);
  assert.equal(await page.locator('#youtubeAccountDialog select').count(), 0);
  assert.match(await page.locator('#youtubeBridgeHelp summary').innerText(), /Instalar en/);
  await page.locator('#youtubeAccountClose').click();
  await page.waitForFunction(() => document.activeElement.id === 'optionsMenuButton');
  await trigger.click();
  await instagram.click();
  assert.equal(await page.locator('#instagramAccountDialog').evaluate(e => e.open), true);
  assert.equal(await menu.isVisible(), false);
  await page.locator('#instagramAccountClose').click();
  await page.waitForFunction(() => document.activeElement.id === 'optionsMenuButton');
  await trigger.click();
  await page.locator('#urlInput').click();
  assert.equal(await menu.isVisible(), false, 'Outside clicks dismiss the menu');
  await trigger.focus();
  await page.keyboard.press('ArrowUp');
  assert.equal(await instagram.evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
}

async function sharedPerformanceChecks(page) {
  const response = page.waitForResponse(`${base}/api/info`);
  await page.locator('#urlInput').fill('https://www.youtube.com/watch?v=performance1');
  await response;
  await page.locator('#resultsPanel.visible').waitFor();

  // The results panel enters with a transform animation. Settle it and place the
  // real pointer over the grid so a native pointerleave cannot reset the effect
  // between our synthetic pointer burst and the next animation frame.
  await page.locator('#resultsPanel').evaluate(async panel => {
    await Promise.all(panel.getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished));
  });
  await page.locator('#qualityGrid .quality-option__label').first().hover();

  const spotlight = await page.evaluate(async () => {
    const prototype = Element.prototype;
    const original = prototype.getBoundingClientRect;
    let reads = 0;
    prototype.getBoundingClientRect = function (...args) {
      if (this.id === 'qualityGrid' || this.classList?.contains('quality-option__label')) reads += 1;
      return original.apply(this, args);
    };
    try {
      const grid = document.querySelector('#qualityGrid');
      const label = grid.querySelector('.quality-option__label');
      const bounds = original.call(label);
      for (let index = 0; index < 80; index += 1) {
        grid.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
        }));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        reads,
        options: grid.querySelectorAll('.quality-option__label').length,
        strength: label.style.getPropertyValue('--spotlight-strength'),
      };
    } finally {
      prototype.getBoundingClientRect = original;
    }
  });
  assert.ok(spotlight.reads <= spotlight.options + 1, 'Pointer events should share one cached geometry read');
  assert.ok(Number(spotlight.strength) > 0, 'The optimized spotlight should remain interactive');

  const previousSessionReads = sessionReads;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitUntil(() => sessionReads > previousSessionReads);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(sessionReads, previousSessionReads + 1, 'Focus and visibility should share one session refresh');
  await page.locator('#homeReset').click();
}

async function youtubeAuthRetryChecks(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('downlink.youtube-browser.v1', JSON.stringify({ browser: 'firefox', enabled: true }));
    window.syntheticYouTubeSession = false;
    window.addEventListener('message', event => {
      if (event.source !== window || event.data?.type !== 'downlink-youtube-login-start') return;
      window.syntheticYouTubeSession = true;
      window.postMessage({ type: 'downlink-youtube-capture-result', requestId: event.data.requestId,
        ok: true, connected: true }, window.location.origin);
    });
  });
  const page = await context.newPage();
  await page.route('**/api/youtube/session', async route => route.fulfill({ json: {
    available: true, connected: await page.evaluate(() => window.syntheticYouTubeSession),
  } }));
  await page.route('**/api/youtube/chrome/capture/start', route => route.fulfill({ json: { captureToken: 'a'.repeat(43) } }));
  const attempts = [];
  await page.route('**/api/info', async route => {
    const body = route.request().postDataJSON();
    attempts.push(body);
    if (!body.youtubeBrowser) {
      return route.fulfill({ status: 401, json: { code: 'YOUTUBE_AUTH_REQUIRED', error: 'Se necesita una cuenta autorizada.' } });
    }
    return route.fulfill({ json: {
      url: body.url, platform: 'youtube', title: 'Vídeo autorizado', channel: 'Prueba',
      thumbnail: `${base}/assets/icons/favicon.svg`, duration: 60,
      videoFormats: [{ height: 720, label: '720p' }], audioQualities: MP3_QUALITIES,
    } });
  });
  await page.goto(base);
  await page.locator('#urlInput').fill('https://youtu.be/bUlzyFz-1fo');
  await page.locator('#youtubeAuthAction').waitFor({ state: 'visible' });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].youtubeBrowser, null, 'An old Firefox selection must not activate a session');
  await page.locator('#youtubeAuthAction').click();
  await page.locator('#youtubeBrowserEnable').click();
  await page.locator('#resultsPanel.visible').waitFor();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].youtubeBrowser, 'chrome');
  assert.equal(attempts[1].url, 'https://youtu.be/bUlzyFz-1fo');
  assert.equal(await page.locator('#youtubeAccountDialog').evaluate(dialog => dialog.open), false);
  await page.route('**/api/download', route => route.fulfill({
    status: 401, json: { code: 'YOUTUBE_CHROME_SESSION_EXPIRED', error: 'La sesión ha caducado.' },
  }));
  await page.locator('#downloadBtn').click();
  await page.locator('#youtubeAuthAction').waitFor({ state: 'visible' });
  await page.locator('#youtubeAuthAction').click();
  await page.locator('#youtubeBrowserEnable').click();
  await waitUntil(() => attempts.length === 3);
  await page.locator('#resultsPanel.visible').waitFor();
  assert.equal(attempts.length, 3, 'Reconnecting after a download error reanalyzes without starting another download');
  await context.close();
  console.log('YouTube authentication prompt and retry passed');
}

async function youtubeChromeConnectChecks(browser, needsLogin) {
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(pending => {
    window.syntheticYouTubeSession = false;
    window.syntheticYouTubeRequests = [];
    window.addEventListener('message', event => {
      if (event.source !== window || !event.data?.type?.startsWith('downlink-youtube-login-')) return;
      const { type, requestId } = event.data;
      window.syntheticYouTubeRequests.push(type);
      const waiting = pending && type === 'downlink-youtube-login-start';
      if (!waiting) window.syntheticYouTubeSession = true;
      window.postMessage({ type: 'downlink-youtube-capture-result', requestId,
        ok: true, pending: waiting, connected: !waiting }, window.location.origin);
    });
  }, needsLogin);
  const page = await context.newPage();
  await page.route('**/api/youtube/session', async route => route.fulfill({ json: {
    available: true, connected: await page.evaluate(() => window.syntheticYouTubeSession),
  } }));
  await page.route('**/api/youtube/chrome/capture/start', route => route.fulfill({ json: { captureToken: 'a'.repeat(43) } }));
  await page.goto(base);
  await page.locator('#optionsMenuButton').click();
  await page.locator('#youtubeAccountButton').click();
  assert.equal(await page.locator('#youtubeAccountDialog select').count(), 0);
  assert.equal(await page.locator('#youtubeAccountDialog .instagram-dialog__actions button:not([hidden])').count(), 1);
  await page.locator('#youtubeBrowserEnable').click();
  await page.waitForFunction(() => document.querySelector('#youtubeAccountDialog').dataset.connectionState === 'connected');
  const requests = await page.evaluate(() => window.syntheticYouTubeRequests);
  assert.deepEqual(requests, needsLogin
    ? ['downlink-youtube-login-start', 'downlink-youtube-login-check']
    : ['downlink-youtube-login-start']);
  await context.close();
}

async function youtubeMissingBridgeChecks(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('**/api/youtube/session', route => route.fulfill({ json: { available: true, connected: false } }));
  await page.route('**/api/youtube/chrome/capture/start', route => route.fulfill({ json: { captureToken: 'a'.repeat(43) } }));
  await page.goto(base);
  await page.locator('#optionsMenuButton').click();
  await page.locator('#youtubeAccountButton').click();
  await page.locator('#youtubeBrowserEnable').click();
  await page.waitForFunction(() => document.querySelector('#youtubeBridgeHelp').open);
  await page.waitForFunction(() => document.querySelector('#youtubeBrowserNotice').textContent.includes('No se encontró la extensión'));
  assert.match(await page.locator('#youtubeBrowserNotice').innerText(), /No se encontró la extensión/);
  assert.equal(await page.locator('#youtubeAccountConnectionStatus').innerText(), 'No se pudo conectar');
  assert.equal(await page.locator('#youtubeBrowserEnable').innerText(), 'Volver a intentar');
  assert.equal(await page.locator('#youtubeBrowserNotice .youtube-account-notice__icon').isVisible(), true);
  assert.match(await page.locator('#youtubeBridgeHelp').innerText(), /Cargar descomprimida/);
  assert.equal(await page.locator('#youtubeAccountDialog select').count(), 0);
  await page.waitForFunction(() => !document.querySelector('#youtubeBridgeHelp').hasAttribute('data-resizing'));
  await page.screenshot({ path: path.join(output, 'youtube-extension-error.png'), animations: 'disabled' });
  await context.close();
}

async function youtubeConnectionFeedbackChecks(browser, name, reducedMotion) {
  const context = await browser.newContext({
    serviceWorkers: 'block', viewport: { width: 320, height: 568 }, reducedMotion,
  });
  await context.addInitScript(() => {
    window.syntheticYouTubeSession = false;
    window.addEventListener('message', event => {
      if (event.source !== window || event.data?.type !== 'downlink-youtube-login-start') return;
      window.syntheticYouTubeSession = true;
      window.postMessage({ type: 'downlink-youtube-capture-result', requestId: event.data.requestId,
        ok: true, connected: true }, window.location.origin);
    });
  });
  const page = await context.newPage();
  let failure = 'server';
  await page.route('**/api/youtube/session', async route => route.fulfill({ json: {
    available: true, connected: await page.evaluate(() => window.syntheticYouTubeSession),
  } }));
  await page.route('**/api/youtube/chrome/capture/start', route => {
    if (failure === 'network') return route.abort('failed');
    if (failure === 'server') return route.fulfill({ status: 503,
      json: { error: 'No se pudo preparar la conexión. Vuelve a intentarlo.' } });
    return route.fulfill({ json: { captureToken: 'a'.repeat(43) } });
  });
  await page.goto(base);
  await page.locator('#optionsMenuButton').click();
  await page.locator('#youtubeAccountButton').click();
  await page.locator('#youtubeBridgeHelp summary').click();
  await page.waitForFunction(() => !document.querySelector('#youtubeBridgeHelp').hasAttribute('data-resizing'));
  // The error must remain visible with the instructions expanded on a small screen.
  await page.locator('#youtubeBrowserEnable').click();
  await page.waitForFunction(() => document.querySelector('#youtubeAccountDialog').dataset.connectionState === 'error');
  assert.equal(await page.locator('#youtubeAccountConnectionStatus').innerText(), 'No se pudo conectar');
  assert.equal(await page.locator('#youtubeBrowserEnable').innerText(), 'Volver a intentar');
  assert.equal(await page.locator('#youtubeBrowserNotice').getAttribute('aria-live'), 'polite');
  await page.waitForFunction(() => {
    const notice = document.querySelector('#youtubeBrowserNotice').getBoundingClientRect();
    const container = document.querySelector('#youtubeAccountDialog .instagram-dialog__page').getBoundingClientRect();
    return notice.top >= container.top - 1 && notice.bottom <= container.bottom + 1;
  });
  await page.screenshot({ path: path.join(output, `${name.toLowerCase()}-youtube-error-mobile.png`), animations: 'disabled' });
  failure = 'network';
  const retryState = await page.evaluate(() => {
    document.querySelector('#youtubeBrowserEnable').click();
    return {
      error: document.querySelector('#youtubeBrowserNotice').classList.contains('is-error'),
      status: document.querySelector('#youtubeAccountDialog').dataset.connectionState,
    };
  });
  assert.deepEqual(retryState, { error: false, status: 'pending' }, `${name}: retry clears the previous error immediately`);
  await page.waitForFunction(() => document.querySelector('#youtubeAccountDialog').dataset.connectionState === 'error');
  assert.match(await page.locator('#youtubeBrowserNotice').innerText(), /No se pudo contactar con Downlink/);
  failure = null;
  await page.locator('#youtubeBrowserEnable').click();
  await page.waitForFunction(() => document.querySelector('#youtubeAccountDialog').dataset.connectionState === 'connected');
  assert.equal(await page.locator('#youtubeBrowserNotice.is-error').count(), 0);
  assert.match(await page.locator('#youtubeBrowserNotice').innerText(), /Tu sesión está conectada/);
  await context.close();
  console.log(`${name}: visible connection errors, network failures and successful retry passed`);
}

async function youtubeExtensionGuideChecks(browser, name) {
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36';
  const cases = [
    { id: 'edge', userAgent: `${chromeUA} Edg/142.0`, url: 'edge://extensions', label: 'Microsoft Edge' },
    { id: 'brave', userAgent: chromeUA, brave: true, url: 'brave://extensions', label: 'Brave' },
    { id: 'firefox', userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/142.0', explanation: 'no admite Firefox' },
    { id: 'safari', userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel', maxTouchPoints: 5, explanation: 'móvil/tablet' },
    { id: 'unknown', userAgent: 'Unrecognized browser', explanation: 'Navegador no identificado' },
  ];
  for (const browserInfo of cases) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      await context.addInitScript(info => {
        for (const [key, value] of Object.entries({ userAgent: info.userAgent, userAgentData: undefined,
          platform: info.platform || 'Win32', maxTouchPoints: info.maxTouchPoints || 0,
          brave: info.brave ? { isBrave: async () => true } : undefined })) {
          Object.defineProperty(navigator, key, { configurable: true, value });
        }
      }, browserInfo);
      const page = await context.newPage();
      await page.goto(base);
      await page.waitForFunction(id => document.querySelector('#youtubeBridgeHelp').dataset.browser === id, browserInfo.id);
      await page.locator('#optionsMenuButton').click();
      await page.locator('#youtubeAccountButton').click();
      await page.locator('#youtubeBridgeHelp summary').click();
      await page.waitForFunction(() => !document.querySelector('#youtubeBridgeHelp').hasAttribute('data-resizing'));
      assert.equal(await page.locator('[data-extension-url]').innerText(), browserInfo.url || 'chrome://extensions');
      if (browserInfo.label) {
        assert.ok((await page.locator('#youtubeBridgeHelp summary').innerText()).includes(browserInfo.label));
        assert.equal(await page.locator('[data-extension-compatibility]').isVisible(), false);
      } else {
        assert.ok((await page.locator('[data-extension-compatibility]').innerText()).includes(browserInfo.explanation));
        assert.match(await page.locator('#youtubeBridgeHelp summary').innerText(), /Chrome/);
      }
      if (browserInfo.id === 'edge') {
        assert.equal(await page.locator('[data-extension-load]').innerText(), 'Cargar desempaquetado');
        await page.screenshot({ path: path.join(output, `${name.toLowerCase()}-youtube-edge-guide.png`), animations: 'disabled' });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.locator('#youtubeBridgeHelp summary').click();
      await page.waitForFunction(() => !document.querySelector('#youtubeBridgeHelp').open);
    } finally {
      await context.close();
    }
  }
  console.log(`${name}: browser-specific extension guides, compatibility guidance and disclosure passed`);
}

async function youtubeExpandedFitChecks(browser, name) {
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    // The compatibility explanation, an error and both account buttons are the
    // longest ordinary state. Keep every part visible, including after rotation.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
      Object.defineProperty(navigator, 'userAgentData', { value: undefined });
      localStorage.setItem('downlink.youtube-browser.v1', JSON.stringify({ browser: 'chrome', enabled: true }));
    });
    const page = await context.newPage();
    await page.route('**/api/youtube/session', route => route.fulfill({ json: { available: true, connected: false } }));
    await page.goto(base);
    await page.locator('#optionsMenuButton').click();
    await page.locator('#youtubeAccountButton').click();
    await page.waitForFunction(() => document.querySelector('#youtubeAccountDialog').dataset.connectionState === 'error');
    await page.locator('#youtubeBridgeHelp summary').click();
    await page.waitForFunction(() => !document.querySelector('#youtubeBridgeHelp').hasAttribute('data-resizing'));
    for (const [width, height] of [[1366, 768], [390, 844], [320, 568], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height });
      const fit = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        const dialog = document.querySelector('#youtubeAccountDialog');
        const sheet = dialog.querySelector('.instagram-dialog__page');
        const guide = document.querySelector('#youtubeBridgeHelp');
        const bounds = sheet.getBoundingClientRect();
        const controls = [...dialog.querySelectorAll('button:not([hidden]), summary, li, [data-extension-compatibility], .instagram-dialog__privacy')];
        return {
          scrollY: sheet.scrollHeight - sheet.clientHeight,
          scrollX: sheet.scrollWidth - sheet.clientWidth,
          guideClip: guide.scrollHeight - guide.clientHeight,
          allVisible: controls.every(element => {
            const rect = element.getBoundingClientRect();
            return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1
              && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          }),
          inViewport: bounds.top >= 0 && bounds.bottom <= innerHeight,
        };
      });
      assert.ok(fit.scrollY <= 1 && fit.scrollX <= 1 && fit.guideClip <= 1,
        `${name} ${width}×${height}: expanded modal must fit without scrolling or clipping: ${JSON.stringify(fit)}`);
      assert.ok(fit.allVisible && fit.inViewport, `${name} ${width}×${height}: every control and instruction remains visible`);
      await page.screenshot({ path: path.join(output, `${name.toLowerCase()}-youtube-expanded-${width}.png`), animations: 'disabled' });
    }
  } finally {
    await context.close();
  }
  console.log(`${name}: fully expanded YouTube modal fits desktop, small phones and landscape without scrolling`);
}

async function instagramCompactFitChecks(browser, name) {
  const initialSession = { available: true, connected: false, pending: false, csrfToken: 'synthetic-token' };
  const error = 'No se detectó el puente de Instagram. Instala la extensión local incluida con Downlink y vuelve a confirmar.';
  for (const state of ['disconnected', 'pending', 'pending-error', 'connected', 'unavailable', 'error']) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      let sessionFailure = state === 'error';
      const session = { ...initialSession,
        pending: state.startsWith('pending'), connected: state === 'connected', available: state !== 'unavailable',
        expiresAt: state === 'connected' ? new Date(Date.now() + 3_600_000).toISOString() : null,
      };
      await page.route('**/api/instagram/session', route => route.fulfill(sessionFailure
        ? { status: 503, json: { error } } : { json: session }));
      await page.route('**/api/instagram/login/complete', route => {
        sessionFailure = true;
        return route.fulfill({ status: 503, json: { error } });
      });
      await page.goto(base);
      await page.waitForFunction(() => document.querySelector('#instagramAccountButton').dataset.connectionState !== 'loading');
      await page.locator('#optionsMenuButton').click();
      await page.locator('#instagramAccountButton').click();
      if (state === 'pending-error') {
        await page.locator('#instagramAccountComplete').click();
        await page.waitForFunction(() => !document.querySelector('#instagramAccountError').hidden
          && document.querySelector('#instagramAccountDialog').getAttribute('aria-busy') === 'false');
      }
      if (state === 'connected') assert.match(await page.locator('#instagramAccountDescription').innerText(), /Caduca a las/);
      if (state.startsWith('pending')) {
        assert.equal(await page.locator('#instagramAccountComplete').isVisible(), true);
        assert.equal(await page.locator('#instagramAccountCancel').isVisible(), true);
      }
      for (const [width, height] of [[1366, 768], [390, 844], [320, 568], [844, 390], [568, 320]]) {
        await page.setViewportSize({ width, height });
        const fit = await page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          const dialog = document.querySelector('#instagramAccountDialog');
          const sheet = dialog.querySelector('.instagram-dialog__page');
          const bounds = sheet.getBoundingClientRect();
          const content = [...dialog.querySelectorAll('h2, p:not([hidden]), button:not([hidden]), .instagram-dialog__connection, .instagram-dialog__privacy')];
          const title = document.querySelector('#instagramAccountTitle').getBoundingClientRect();
          const close = document.querySelector('#instagramAccountClose').getBoundingClientRect();
          return {
            scrollY: sheet.scrollHeight - sheet.clientHeight, scrollX: sheet.scrollWidth - sheet.clientWidth,
            inViewport: bounds.top >= 0 && bounds.bottom <= innerHeight,
            titleClear: title.right <= close.left || title.bottom <= close.top || title.top >= close.bottom,
            allVisible: content.every(element => {
              const rect = element.getBoundingClientRect();
              return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1
                && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
            }),
          };
        });
        assert.ok(fit.scrollY <= 1 && fit.scrollX <= 1 && fit.inViewport && fit.allVisible && fit.titleClear,
          `${name} Instagram ${state} ${width}×${height}: complete modal must fit: ${JSON.stringify(fit)}`);
        if (state === 'pending-error' && [1366, 320, 568].includes(width)) {
          await page.screenshot({ path: path.join(output, `${name.toLowerCase()}-instagram-compact-${width}.png`), animations: 'disabled' });
        }
      }
    } finally {
      await context.close();
    }
  }
  console.log(`${name}: compact Instagram states, errors and account actions fit without scrolling`);
}

async function mobileChecks(browser, name) {
  const context = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce', acceptDownloads: true });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText() {
          window.clipboardReadCount = (window.clipboardReadCount || 0) + 1;
          return Promise.resolve('https://www.youtube.com/watch?v=clipboard01');
        },
      },
    });
  });
  const { page, errors, diagnostics } = await prepare(context);
  const analyze = async url => {
    const response = page.waitForResponse(`${base}/api/info`);
    await page.locator('#urlInput').fill(url);
    await response;
    await page.locator('#resultsPanel.visible').waitFor();
    await page.waitForFunction(() => !document.querySelector('#urlInput').disabled);
  };
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(650);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
    await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await menuChecks(page, name);

  assert.equal(await page.evaluate(() => isSecureContext), true);
  const pasteResponse = page.waitForResponse(`${base}/api/info`);
  await page.locator('#urlPasteButton').tap();
  await pasteResponse;
  await page.locator('#resultsPanel.visible').waitFor();
  assert.equal(await page.locator('#urlInput').inputValue(), 'https://www.youtube.com/watch?v=clipboard01');
  assert.equal(await page.evaluate(() => window.clipboardReadCount), 1, `${name}: paste should read the clipboard once`);
  await page.locator('#homeReset').click();

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await page.locator('#urlPasteButton').tap();
  assert.equal(await page.locator('#urlInput').evaluate(element => element === document.activeElement), true);
  assert.match(await page.locator('#inputHint').innerText(), /Mantén pulsado el campo y toca Pegar/);

  await analyze('https://www.youtube.com/watch?v=abcdefghijk');
  const thumbnailFit = await page.locator('#videoThumbnail').evaluate(element => {
    const image = element.getBoundingClientRect();
    const frame = element.parentElement.getBoundingClientRect();
    return {
      objectFit: getComputedStyle(element).objectFit,
      fillsFrame: Math.abs(image.width - frame.width) <= 1.1 && Math.abs(image.height - frame.height) <= 1.1,
    };
  });
  assert.equal(thumbnailFit.objectFit, 'cover', `${name}: thumbnail should preserve its ratio and cover the frame`);
  assert.equal(thumbnailFit.fillsFrame, true, `${name}: thumbnail should fill the complete frame`);
  const durationBadge = await page.locator('.video-card__duration-badge').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
      height: element.getBoundingClientRect().height,
      minWidth: style.minWidth,
      sheenContent: getComputedStyle(element, '::after').content,
    };
  });
  assert.equal(durationBadge.height, 24, `${name}: duration label should be compact`);
  assert.equal(durationBadge.minWidth, '42px', `${name}: duration label should use the iOS width`);
  assert.match(durationBadge.backgroundColor, /^rgba\(0, 0, 0, 0\.62\)$/);
  assert.match(durationBadge.backdropFilter, /blur\(5px\)/);
  assert.equal(durationBadge.sheenContent, 'none', `${name}: pale glass sheen should be disabled`);
  await page.screenshot({ path: path.join(output, `${name}-results.png`), fullPage: true, animations: 'disabled' });
  const initialStarts = starts;
  await page.locator('#downloadBtn').click();
  await page.waitForFunction(() => Boolean(localStorage.getItem('downlink.download.v1')));
  const pendingId = await page.evaluate(() => JSON.parse(localStorage.getItem('downlink.download.v1')).jobId);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#urlInput').disabled);
  assert.equal(starts, initialStarts + 1, 'Reload must resume the existing conversion');

  diagnostics.networkOutage = true;
  await context.setOffline(true);
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Retomar descarga');
  assert.equal(await page.locator('#connectionNotice').isVisible(), true);
  if (name.startsWith('webkit')) {
    // Playwright 1.63 rejects SW navigation before the worker runs when using
    // setOffline: https://github.com/microsoft/playwright/issues/42775
    // Stop the origin instead to exercise the real network-failure fallback.
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
    await context.setOffline(false);
  }
  const offlineResponse = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(offlineResponse.fromServiceWorker(), true);
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Retomar descarga');
  await page.screenshot({ path: path.join(output, `${name}-offline.png`), fullPage: true });
  const filesBeforeAutomaticPrompt = files;
  jobs.get(pendingId).status = 'ready';
  if (name.startsWith('webkit')) {
    server.listen(Number(new URL(base).port), '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    await page.locator('#downloadBtn').click();
  } else {
    await context.setOffline(false);
  }
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Guardar MP4');
  await waitUntil(() => files > filesBeforeAutomaticPrompt);
  diagnostics.networkOutage = false;
  assert.equal(starts, initialStarts + 1, 'Reconnection must not duplicate a conversion');
  assert.equal(await page.evaluate(() => localStorage.getItem('downlink.download.auto-prompt.v1')), pendingId);
  const filesAfterAutomaticPrompt = files;
  await page.locator('#downloadBtn').click();
  await waitUntil(() => files > filesAfterAutomaticPrompt);
  const filesAfterManualSave = files;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Guardar MP4');
  assert.equal(files, filesAfterManualSave, 'Reopening must not repeat the first automatic system prompt');
  assert.equal(starts, initialStarts + 1, 'Ready files survive reopening without reconversion');

  const cachedPaths = await page.evaluate(async () => {
    const entries = await Promise.all((await caches.keys()).map(async key =>
      (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)));
    return entries.flat();
  });
  assert.ok(cachedPaths.includes('/index.html'));
  assert.ok(cachedPaths.every(url => !url.startsWith('/api/')), 'Never cache jobs, sessions or media');
  jobs.delete(pendingId);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#errorText').textContent.includes('ya no está disponible'));
  assert.equal(await page.evaluate(() => localStorage.getItem('downlink.download.v1')), null);

  await analyze('https://www.youtube.com/watch?v=abcdefghij2');
  await page.locator('[data-format="mp3"]').click();
  await page.locator('#downloadBtn').click();
  await waitUntil(() => starts === initialStarts + 2);
  assert.equal(lastJob.format, 'mp3');
  const mp3Files = files;
  lastJob.status = 'ready';
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Guardar MP3');
  await waitUntil(() => files > mp3Files);
  assert.equal(await page.locator('#downloadBtnText').innerText(), 'Guardar MP3', 'Guardar remains available after the automatic prompt');
  await page.locator('#homeReset').click();
  await analyze('https://www.youtube.com/watch?v=abcdefghij3');
  await page.locator('#downloadBtn').click();
  await page.waitForFunction(() => Boolean(localStorage.getItem('downlink.download.v1')));
  await page.locator('#cancelDownloadBtn').click();
  await page.waitForFunction(() => document.querySelector('#progressText').textContent === 'Descarga cancelada');
  assert.equal(await page.evaluate(() => localStorage.getItem('downlink.download.v1')), null);
  assert.deepEqual(errors, [], `${name}: page errors`);
  await context.close();
  console.log(`${name}: layouts, options menu, Instagram dialog, MP4/MP3, reload, offline recovery, save, expiry, cancellation and cache isolation passed`);
}

let chrome;
let safari;
try {
  chrome = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  await overlayEntranceChecks(chrome, 'Chrome');
  await disclosureResizeChecks(chrome, 'Chrome');
  await youtubeChromeConnectChecks(chrome, false);
  await youtubeChromeConnectChecks(chrome, true);
  await youtubeMissingBridgeChecks(chrome);
  await youtubeConnectionFeedbackChecks(chrome, 'Chrome', 'no-preference');
  await youtubeExtensionGuideChecks(chrome, 'Chrome');
  await youtubeExpandedFitChecks(chrome, 'Chrome');
  await instagramCompactFitChecks(chrome, 'Chrome');
  console.log('Single Chrome connection button: existing session and sign-in window passed');
  await youtubeAuthRetryChecks(chrome);
  const desktop = await chrome.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const { page, errors } = await prepare(desktop);
  assert.equal(
    await page.locator('#videoThumbnail').evaluate(element => getComputedStyle(element).objectFit),
    'cover',
    'Desktop thumbnail should cover its frame without distortion',
  );
  const desktopDurationBadge = await page.locator('.video-card__duration-badge').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
      height: style.height,
      minWidth: style.minWidth,
      sheenContent: getComputedStyle(element, '::after').content,
    };
  });
  assert.deepEqual(desktopDurationBadge, {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    backdropFilter: 'blur(5px) saturate(1.1)',
    height: '24px',
    minWidth: '42px',
    sheenContent: 'none',
  }, 'Desktop should share the compact iOS duration label');
  await page.mouse.move(720, 500);
  await page.waitForFunction(() => window.backgroundPointerPresence > 0.1);
  await page.waitForTimeout(1100);
  const metrics = await page.evaluate(() => Object.fromEntries([
    '.app-container', '.header', '.header__logo', '.home-controls', '.home-intro', '.footer',
  ].map(selector => {
    const element = document.querySelector(selector), rect = element.getBoundingClientRect(), css = getComputedStyle(element);
    return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      font: css.font, color: css.color, background: css.background }];
  })));
  if (process.argv.includes('--compare-baseline')) {
    assert.deepEqual(metrics, JSON.parse(await fs.readFile(path.join(output, 'desktop-before.json'), 'utf8')));
  }
  await menuChecks(page, 'desktop');
  await sharedPerformanceChecks(page);
  // Upgrades discard the retired local identity, without blocking startup.
  await page.evaluate(() => {
    localStorage.setItem('downlink.profiles.v1', JSON.stringify([{ id: 'old', name: 'Old profile' }]));
    localStorage.setItem('downlink.activeProfileId.v1', 'old');
  });
  await page.reload();
  await page.waitForFunction(() => localStorage.getItem('downlink.profiles.v1') === null);
  assert.equal(await page.evaluate(() => localStorage.getItem('downlink.activeProfileId.v1')), null);
  assert.equal(await page.locator('#urlInput').isEnabled(), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'desktop-after.png'), fullPage: true, animations: 'disabled' });
  await desktop.close();
  console.log('Desktop layout preserved');
  const fallbackContext = await chrome.newContext({ ...devices['iPhone 13'] });
  await fallbackContext.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    };
  });
  const fallback = await prepare(fallbackContext, { fallback: true });
  assert.deepEqual(fallback.errors, []);
  await fallback.page.screenshot({ path: path.join(output, 'iphone-background-fallback.png'), fullPage: true });
  await fallbackContext.close();
  console.log('Opaque desktop black, contour contrast and the no-WebGL fallback verified');
  if (!process.argv.includes('--webkit-only')) await mobileChecks(chrome, 'chromium-iphone');
  safari = await webkit.launch();
  await overlayEntranceChecks(safari, 'WebKit');
  await disclosureResizeChecks(safari, 'WebKit');
  await youtubeConnectionFeedbackChecks(safari, 'WebKit', 'reduce');
  await youtubeExtensionGuideChecks(safari, 'WebKit');
  await youtubeExpandedFitChecks(safari, 'WebKit');
  await instagramCompactFitChecks(safari, 'WebKit');
  await mobileChecks(safari, 'webkit-iphone');
} finally {
  await chrome?.close();
  await safari?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
