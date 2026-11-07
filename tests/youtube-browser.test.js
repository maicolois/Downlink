import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeProvider } from '@/server/platforms/youtube/youtube-provider.js';
import {
  getYouTubeBrowserArgs,
  normalizeYouTubeBrowser,
} from '@/server/platforms/youtube/youtube-browser.js';
import { getYouTubeError } from '@/server/platforms/youtube/youtube-errors.js';

test('passes the selected local browser directly to yt-dlp without a cookie file', () => {
  assert.equal(normalizeYouTubeBrowser(' FIREFOX '), 'firefox');
  assert.deepEqual(getYouTubeBrowserArgs('firefox'), ['--cookies-from-browser', 'firefox']);

  const provider = new YouTubeProvider({ browser: 'firefox' });
  assert.equal(provider.usesLocalSession, true);
  assert.deepEqual(provider.getInfoYtDlpArgs(), [
    '--ignore-config',
    '--extractor-args', 'youtube:skip=hls,dash',
    '--cookies-from-browser', 'firefox',
  ]);
  assert.deepEqual(provider.getYtDlpArgs(), ['--ignore-config', '--cookies-from-browser', 'firefox']);
  assert.equal(provider.getYtDlpArgs().includes('--cookies'), false);
});

test('uses only the temporary Chrome bridge jar when one is provided', () => {
  const provider = new YouTubeProvider({
    browser: 'chrome',
    cookiesFile: 'C:\\Temp\\downlink-youtube\\cookies.txt',
  });
  assert.deepEqual(provider.getInfoYtDlpArgs(), [
    '--ignore-config',
    '--extractor-args', 'youtube:skip=hls,dash',
    '--cookies', 'C:\\Temp\\downlink-youtube\\cookies.txt',
  ]);
  assert.deepEqual(provider.getYtDlpArgs(), [
    '--ignore-config', '--cookies', 'C:\\Temp\\downlink-youtube\\cookies.txt',
  ]);
  assert.equal(provider.getYtDlpArgs().includes('--cookies-from-browser'), false);
});

test('passes an explicitly discovered Deno runtime to every YouTube extraction', () => {
  const provider = new YouTubeProvider({ browser: 'firefox', denoPath: 'C:\\local\\deno.exe' });
  assert.deepEqual(provider.getInfoYtDlpArgs().slice(0, 5), [
    '--ignore-config', '--js-runtimes', 'deno:C:\\local\\deno.exe',
    '--extractor-args', 'youtube:skip=hls,dash',
  ]);
  assert.deepEqual(provider.getYtDlpArgs(), [
    '--ignore-config', '--js-runtimes', 'deno:C:\\local\\deno.exe',
    '--cookies-from-browser', 'firefox',
  ]);
});

test('uses the application Node runtime for YouTube when Deno is unavailable', () => {
  const provider = new YouTubeProvider({ nodePath: 'C:\\Program Files\\nodejs\\node.exe' });
  for (const args of [provider.getInfoYtDlpArgs(), provider.getYtDlpArgs()]) {
    assert.deepEqual(args.slice(0, 3), ['--ignore-config', '--js-runtimes', 'node:C:\\Program Files\\nodejs\\node.exe']);
  }
  const deno = new YouTubeProvider({ denoPath: 'deno', nodePath: 'node' });
  assert.deepEqual(deno.getRuntimeArgs(), ['--js-runtimes', 'deno:deno']);
});

test('accepts only supported local browser identifiers in the extractor', () => {
  assert.equal(normalizeYouTubeBrowser(null), null);
  for (const browser of ['brave', 'chrome', 'edge', 'firefox']) {
    assert.equal(normalizeYouTubeBrowser(browser), browser);
  }
  for (const browser of ['safari', 'chromium', '../cookies.txt', 42, {}]) {
    assert.throws(() => normalizeYouTubeBrowser(browser), error => {
      assert.equal(error.code, 'YOUTUBE_BROWSER_INVALID');
      return true;
    });
  }
});

test('explains how to enable local browser access for restricted content', () => {
  assert.deepEqual(getYouTubeError(new Error('Sign in to confirm your age')), {
    status: 401,
    code: 'YOUTUBE_AUTH_REQUIRED',
    error: 'Confirma tu edad en YouTube.',
  });

  assert.deepEqual(getYouTubeError(new Error('Sign in to confirm your age'), { browser: 'edge' }), {
    status: 401,
    code: 'YOUTUBE_AUTH_REQUIRED',
    error: 'YouTube pide confirmar la edad y no ha aceptado la sesión de Edge. Comprueba que esa cuenta pueda reproducir el vídeo y vuelve a conectar YouTube.',
  });
});

test('turns browser cookie database failures into a local actionable error', () => {
  assert.deepEqual(getYouTubeError(new Error('Could not copy Chrome cookie database'), { browser: 'chrome' }), {
    status: 422,
    code: 'YOUTUBE_BROWSER_SESSION_UNAVAILABLE',
    error: 'No se pudo leer la sesión de Chrome. El navegador o el sistema puede estar bloqueando el acceso; cierra Chrome por completo y vuelve a intentarlo.',
  });
});

test('distinguishes YouTube access, availability, format and network errors', () => {
  const examples = [
    ['Sign in to confirm you’re not a bot', 'YOUTUBE_BOT_CHECK', 403],
    ['This video is age-restricted and YouTube is requiring account age-verification', 'YOUTUBE_AGE_VERIFICATION_REQUIRED', 403],
    ['Private video. Sign in if you have been granted access', 'YOUTUBE_PRIVATE', 403],
    ['This video is available to this channel members only', 'YOUTUBE_MEMBERS_ONLY', 403],
    ['This video is not available in your country', 'YOUTUBE_GEO_RESTRICTED', 403],
    ['This video has been removed', 'YOUTUBE_REMOVED', 404],
    ['Requested format is not available', 'YOUTUBE_FORMAT_UNAVAILABLE', 422],
    ['HTTP Error 429: Too Many Requests', 'YOUTUBE_RATE_LIMIT', 429],
    ['HTTP Error 403: Forbidden', 'YOUTUBE_ACCESS_DENIED', 403],
    ['Connection reset by peer', 'YOUTUBE_NETWORK_ERROR', 503],
    ['Video unavailable', 'YOUTUBE_UNAVAILABLE', 404],
    ['Sign in to view this video', 'YOUTUBE_AUTH_REQUIRED', 401],
  ];
  for (const [message, code, status] of examples) {
    const result = getYouTubeError(new Error(message));
    assert.equal(result?.code, code, message);
    assert.equal(result.status, status, message);
    assert.ok(result.error.length > 30, message);
  }
  assert.equal(getYouTubeError(new Error('Unrecognized platform response')), null);
});

test('diagnoses the actual error instead of an unrelated yt-dlp warning', () => {
  const message = 'WARNING: This video is age-restricted; some formats may be missing\nERROR: [youtube] Requested format is not available';
  assert.equal(getYouTubeError(new Error(message)).code, 'YOUTUBE_FORMAT_UNAVAILABLE');
});

test('does not claim that a missing browser profile is a locked database', () => {
  const result = getYouTubeError(new Error('Could not find Firefox cookies database'), { browser: 'firefox' });
  assert.equal(result.code, 'YOUTUBE_BROWSER_SESSION_UNAVAILABLE');
  assert.match(result.error, /No se encontró el perfil/);
});

test('distinguishes Windows cookie decryption from a browser database lock', () => {
  assert.deepEqual(getYouTubeError(new Error('Failed to decrypt with DPAPI'), { browser: 'edge' }), {
    status: 422,
    code: 'YOUTUBE_BROWSER_DECRYPTION_FAILED',
    error: 'Windows no permite leer las cookies de Edge. Abre Downlink en Chrome y conecta YouTube mediante la extensión de Downlink.',
  });
});
