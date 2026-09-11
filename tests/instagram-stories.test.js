import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getInstagramStorySource, isValidInstagramStoryVideoId } from '../shared/instagram-stories.js';
import { INSTAGRAM_URL_PATTERNS } from '../shared/platform-patterns.js';
import { InstagramProvider } from '../server/platforms/instagram/instagram-provider.js';
import { getInstagramCookieArgs } from '../server/platforms/instagram/instagram-cookies.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const userSource = {
  kind: 'user', username: 'user.name', storyId: null,
  url: 'https://www.instagram.com/stories/user.name/',
};

function removeTemporaryDirectory(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('converter-instagram-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('aliases, profile links and user story links resolve to the same collection', () => {
  const provider = new InstagramProvider({ cookiesFile: '' });
  for (const input of [
    '@User.Name', ' @User.Name ', 'instagram.com/User.Name',
    'https://www.instagram.com/User.Name/?igsh=abc',
    'http://instagram.com/stories/User.Name/?utm_source=copy#ignored',
  ]) {
    assert.deepEqual(getInstagramStorySource(input), userSource);
    assert.equal(provider.normalizeUrl(input), userSource.url);
    assert.ok(INSTAGRAM_URL_PATTERNS.some(pattern => pattern.test(input.trim())));
  }
});

test('individual stories preserve large numeric IDs as strings and highlights remain distinct', () => {
  assert.deepEqual(getInstagramStorySource('instagram.com/stories/User.Name/3999999999999999999/?igsh=abc'), {
    kind: 'story', username: 'user.name', storyId: '3999999999999999999',
    url: 'https://www.instagram.com/stories/user.name/3999999999999999999/',
  });
  assert.deepEqual(getInstagramStorySource('https://www.instagram.com/stories/highlights/19999999999999999/'), {
    kind: 'highlight', username: null, storyId: '19999999999999999',
    url: 'https://www.instagram.com/stories/highlights/19999999999999999/',
  });
});

test('story helpers reject unrelated hosts, reserved routes and ambiguous paths', () => {
  for (const input of [
    null, {}, '', 'user.name', '@', '@user name', '@user-name', '@accounts', '@..',
    `@${'a'.repeat(31)}`, 'https://instagram.com/../',
    'https://instagram.com/explore/', 'https://instagram.com/direct/',
    'https://instagram.com/accounts/', 'https://instagram.com/stories/',
    'https://instagram.com/reels/', 'https://instagram.com/p/',
    'https://instagram.com/stories/accounts/', 'https://instagram.com/stories/highlights/',
    'https://instagram.com/stories/user/abc/', 'https://instagram.com/stories/user/123/extra',
    'https://instagram.com/user/followers/', 'https://instagram.com//user/',
    'https://instagram.com.evil.example/user/', 'https://evil.example/instagram.com/user/',
    'https://www.instagram.com@evil.example/user/', 'https://evil.example@instagram.com/user/',
    'ftp://instagram.com/user/', 'https://instagram.com:8443/user/',
    'https://instagram.com/stories/user/%31/',
  ]) {
    assert.equal(getInstagramStorySource(input), null, String(input));
    if (typeof input === 'string') {
      assert.equal(INSTAGRAM_URL_PATTERNS.some(pattern => pattern.test(input)), false, input);
    }
  }
  assert.equal(getInstagramStorySource('https://instagram.com/p/ABC123/'), null);
});

test('story selections only accept bounded yt-dlp shortcodes', () => {
  for (const value of ['ABC123', 'C_ab-123', 'a'.repeat(64)]) {
    assert.equal(isValidInstagramStoryVideoId(value), true);
  }
  for (const value of [null, 123, '', 'a'.repeat(65), "abc' | id", 'a b', 'ábc', '../abc']) {
    assert.equal(isValidInstagramStoryVideoId(value), false);
  }
});

test('story extraction preserves authentication errors and bypasses post view enrichment', async () => {
  const provider = new InstagramProvider({ cookiesFile: '' });
  const infos = [{ id: 'ABC', view_count: null }];
  for (const url of ['@user.name', userSource.url, 'https://instagram.com/stories/highlights/123/']) {
    assert.deepEqual(provider.getInfoYtDlpArgs({ url }), ['--ignore-config', '--yes-playlist']);
    assert.equal(await provider.enrichVideoInfos(infos, { url }), infos);
  }
  assert.deepEqual(provider.getInfoYtDlpArgs({ url: 'https://instagram.com/stories/user/123/' }), ['--ignore-config', '--no-playlist']);
  assert.deepEqual(provider.getInfoYtDlpArgs({ url: 'https://instagram.com/p/ABC/' }), ['--ignore-config', '--yes-playlist', '--ignore-errors']);
});

test('story downloads select a stable shortcode even when playlist positions change', () => {
  const provider = new InstagramProvider({ cookiesFile: '' });
  for (const playlistItem of [1, 4, 20]) {
    assert.deepEqual(provider.getYtDlpArgs({ url: '@user.name', videoId: 'C_ab-123', playlistItem }), [
      '--ignore-config', '--yes-playlist', '--match-filters', "id = 'C_ab-123'",
    ]);
  }
  assert.deepEqual(provider.getYtDlpArgs({ url: 'https://instagram.com/stories/user/123/', videoId: 'C_ab-123' }), [
    '--ignore-config', '--no-playlist', '--match-filters', "id = 'C_ab-123'",
  ]);
  assert.throws(() => provider.getYtDlpArgs({ url: '@user.name' }), { code: 'INSTAGRAM_STORY_INVALID_ID' });
  assert.throws(() => provider.getYtDlpArgs({ url: '@user.name', videoId: "abc' | id" }), { code: 'INSTAGRAM_STORY_INVALID_ID' });
  assert.deepEqual(provider.getYtDlpArgs({ url: 'https://instagram.com/p/ABC/', playlistItem: 3 }), ['--ignore-config', '--playlist-items', '3']);
});

test('explicit cookie files are used for metadata and downloads without reading browser sessions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-instagram-cookies-'));
  const cookiesFile = path.join(directory, 'cookies.txt');
  fs.writeFileSync(cookiesFile, '# Netscape HTTP Cookie File\n');
  t.after(() => removeTemporaryDirectory(directory));
  const cookieArgs = ['--cookies', fs.realpathSync(cookiesFile)];
  const provider = new InstagramProvider({ cookiesFile });
  assert.deepEqual(provider.getInfoYtDlpArgs({ url: '@user.name' }), ['--ignore-config', '--yes-playlist', ...cookieArgs]);
  assert.deepEqual(provider.getYtDlpArgs({ url: '@user.name', videoId: 'ABC' }), [
    '--ignore-config', '--yes-playlist', '--match-filters', "id = 'ABC'", ...cookieArgs,
  ]);
  assert.deepEqual(provider.getInfoYtDlpArgs(), ['--ignore-config', '--yes-playlist', '--ignore-errors', ...cookieArgs]);
  assert.deepEqual(provider.getYtDlpArgs(), ['--ignore-config', '--playlist-items', '1', ...cookieArgs]);
  assert.deepEqual(getInstagramCookieArgs(undefined), []);
  assert.deepEqual(getInstagramCookieArgs(''), []);
  for (const invalidPath of [directory, path.join(directory, 'missing-secret.txt')]) {
    assert.throws(() => getInstagramCookieArgs(invalidPath), error => {
      assert.equal(error.code, 'INSTAGRAM_COOKIES_INVALID');
      assert.equal(error.message.includes(invalidPath), false);
      return true;
    });
  }
});

test('cookie files are rejected inside every statically served directory', t => {
  for (const directory of ['public', 'shared', 'downloads']) {
    const servedDirectory = path.join(projectRoot, directory);
    fs.mkdirSync(servedDirectory, { recursive: true });
    const cookiesFile = path.join(servedDirectory, `.instagram-cookie-test-${process.pid}.txt`);
    fs.writeFileSync(cookiesFile, '# Netscape HTTP Cookie File\n');
    t.after(() => fs.rmSync(cookiesFile, { force: true }));
    assert.throws(() => getInstagramCookieArgs(cookiesFile), { code: 'INSTAGRAM_COOKIES_INVALID' });
  }
});

test('a directory link outside the site cannot expose cookies stored inside the site', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-instagram-link-'));
  const servedDirectory = path.join(projectRoot, 'public');
  const cookiesFile = path.join(servedDirectory, `.instagram-cookie-link-test-${process.pid}.txt`);
  const linkedDirectory = path.join(directory, 'linked-public');
  fs.writeFileSync(cookiesFile, '# Netscape HTTP Cookie File\n');
  t.after(() => {
    fs.rmSync(cookiesFile, { force: true });
    removeTemporaryDirectory(directory);
  });
  try {
    fs.symlinkSync(servedDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('Directory links are unavailable');
    throw error;
  }
  assert.throws(() => getInstagramCookieArgs(path.join(linkedDirectory, path.basename(cookiesFile))), {
    code: 'INSTAGRAM_COOKIES_INVALID',
  });
});

test('a directory link inside the site cannot be used to load a private cookie file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-instagram-private-'));
  const cookiesFile = path.join(directory, 'cookies.txt');
  const linkedDirectory = path.join(projectRoot, 'public', `.instagram-cookie-private-test-${process.pid}`);
  fs.writeFileSync(cookiesFile, '# Netscape HTTP Cookie File\n');
  t.after(() => {
    if (fs.existsSync(linkedDirectory)) fs.unlinkSync(linkedDirectory);
    removeTemporaryDirectory(directory);
  });
  try {
    fs.symlinkSync(directory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('Directory links are unavailable');
    throw error;
  }
  assert.throws(() => getInstagramCookieArgs(path.join(linkedDirectory, 'cookies.txt')), {
    code: 'INSTAGRAM_COOKIES_INVALID',
  });
});
