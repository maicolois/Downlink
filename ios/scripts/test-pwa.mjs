// Browser integration tests against a synthetic API. No third-party downloads
// or personal accounts. The UI and service worker are the production files.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium, webkit, devices } from 'playwright-core';
import { MP3_QUALITIES } from '../../shared/mp3-qualities.js';
import { mountIosAssets } from '../server.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'artifacts/ios');
await fs.mkdir(output, { recursive: true });
const app = express();
app.use(express.json());
mountIosAssets(app);
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
const jobs = new Map();
let starts = 0;
let files = 0;
let lastJob;
app.get('/api/instagram/session', (_req, res) => res.json({ available: false, connected: false, pending: false }));
app.post('/api/info', (req, res) => res.json({
  url: req.body.url, platform: 'youtube', title: 'Vídeo de prueba · Downlink', channel: 'Prueba local',
  thumbnail: `${base}/assets/avatars/ember-fox.webp`, duration: 60, view_count: 1234,
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
const waitUntil = async condition => {
  for (let i = 0; i < 100; i += 1) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for browser behavior');
};

async function prepare(context) {
  await context.addInitScript(() => {
    if (!localStorage.getItem('downlink.profiles.v1')) {
      localStorage.setItem('downlink.profiles.v1', JSON.stringify([
        { id: 'test', name: 'Maico', avatar: { type: 'preset', value: 'ember' } },
      ]));
      localStorage.setItem('downlink.activeProfileId.v1', 'test');
    }
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
  return { page, errors, diagnostics };
}

async function mobileChecks(browser, name) {
  const context = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce', acceptDownloads: true });
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
  await page.locator('#profileMenuButton').click();
  await page.locator('#pwaInstallButton').click();
  assert.equal(await page.locator('#pwaInstallDialog').evaluate(e => e.open), true);
  await page.screenshot({ path: path.join(output, `${name}-install.png`), fullPage: true, animations: 'disabled' });
  await page.locator('#pwaInstallClose').click();

  await analyze('https://www.youtube.com/watch?v=abcdefghijk');
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
  jobs.get(pendingId).status = 'ready';
  if (name.startsWith('webkit')) {
    server.listen(Number(new URL(base).port), '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    await page.locator('#downloadBtn').click();
  } else {
    await context.setOffline(false);
  }
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Guardar MP4');
  diagnostics.networkOutage = false;
  assert.equal(starts, initialStarts + 1, 'Reconnection must not duplicate a conversion');
  const initialFiles = files;
  await page.locator('#downloadBtn').click();
  await waitUntil(() => files > initialFiles);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Guardar MP4');
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
  lastJob.status = 'ready';
  await page.waitForFunction(() => document.querySelector('#downloadBtnText').textContent === 'Guardar MP3');
  await page.locator('#homeReset').click();
  await analyze('https://www.youtube.com/watch?v=abcdefghij3');
  await page.locator('#downloadBtn').click();
  await page.waitForFunction(() => Boolean(localStorage.getItem('downlink.download.v1')));
  await page.locator('#cancelDownloadBtn').click();
  await page.waitForFunction(() => document.querySelector('#progressText').textContent === 'Descarga cancelada');
  assert.equal(await page.evaluate(() => localStorage.getItem('downlink.download.v1')), null);
  assert.deepEqual(errors, [], `${name}: page errors`);
  await context.close();
  console.log(`${name}: layouts, install guide, MP4/MP3, reload, offline recovery, save, expiry, cancellation and cache isolation passed`);
}

let chrome;
let safari;
try {
  chrome = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  const desktop = await chrome.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const { page, errors } = await prepare(desktop);
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
  assert.equal(await page.locator('#pwaInstallButton').isVisible(), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'desktop-after.png'), fullPage: true, animations: 'disabled' });
  await desktop.close();
  console.log('Desktop layout preserved');
  if (!process.argv.includes('--webkit-only')) await mobileChecks(chrome, 'chromium-iphone');
  safari = await webkit.launch();
  await mobileChecks(safari, 'webkit-iphone');
} finally {
  await chrome?.close();
  await safari?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
