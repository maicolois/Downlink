import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMp4FormatSelector } from '@/server/services/mp4-compatibility.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.YT_DLP_PATH || path.join(root, 'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp');
const audio = { format_id: 'aac', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128 };
const video = (id, height, codec, withAudio = false) => ({
  format_id: id, ext: codec.startsWith('vp9') ? 'webm' : 'mp4', width: height * 16 / 9,
  height, fps: 60, vcodec: codec, acodec: withAudio ? 'mp4a.40.2' : 'none', tbr: height * 5,
});

// Run the actual selector against local metadata. No YouTube or media network
// request is needed; this catches fallback precedence changes, not just strings.
test('yt-dlp selects resolution before codec for original and compatible downloads', {
  skip: fs.existsSync(binary) ? false : 'Install the bundled yt-dlp to run selection integration tests',
  timeout: 60_000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downlink-format-selection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const select = (quality, formats) => {
    const info = path.join(dir, 'video.json');
    fs.writeFileSync(info, JSON.stringify({
      id: 'local-format-test', title: 'Local format selection', extractor: 'generic',
      webpage_url: 'https://example.invalid/video', duration: 10,
      formats: formats.map(f => ({ ...f, url: `https://example.invalid/${f.format_id}` })),
    }));
    return spawnSync(binary, ['--ignore-config', '--no-warnings', '--simulate',
      '--load-info-json', info, '-f', buildMp4FormatSelector(quality), '--print', '%(format_id)s'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  };
  const formats = [audio, video('h264-1080', 1080, 'avc1.64002a'), video('vp9-2160', 2160, 'vp9')];
  for (const quality of ['best', '2160']) {
    await t.test(`${quality} selects 4K VP9 ahead of 1080p H.264`, () => {
      const result = select(quality, formats);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'vp9-2160+aac');
    });
  }
  await t.test('an explicit 1080p limit still selects 1080p', () => {
    const result = select('1080', formats);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'h264-1080+aac');
  });
  await t.test('AV1 1440p is not downgraded to H.264 1080p', () => {
    const result = select('1440', [...formats, video('av1-1440', 1440, 'av01.0.12M.08')]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'av1-1440+aac');
  });
  await t.test('a larger combined stream wins over a lower separate video track', () => {
    const result = select('best', [audio, video('h264-1080', 1080, 'avc1.64002a'), video('combined-2160', 2160, 'av01.0.12M.08', true)]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'combined-2160');
  });
  await t.test('video-only sources remain supported', () => {
    const result = select('2160', [video('silent-2160', 2160, 'vp9')]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'silent-2160');
  });
  await t.test('no unbounded fallback silently exceeds the requested limit', () => {
    const result = select('720', formats);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requested format is not available/i);
  });
});
