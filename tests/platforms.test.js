import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformRegistry } from '../server/platforms/common/platform-registry.js';
import { YouTubeProvider } from '../server/platforms/youtube/youtube-provider.js';
import { XProvider } from '../server/platforms/x/x-provider.js';
import { InstagramProvider } from '../server/platforms/instagram/instagram-provider.js';
import { TikTokProvider } from '../server/platforms/tiktok/tiktok-provider.js';
import { RedditProvider } from '../server/platforms/reddit/reddit-provider.js';
import { TwitchProvider } from '../server/platforms/twitch/twitch-provider.js';
import { SUPPORTED_PLATFORM_PATTERNS } from '../shared/platform-patterns.js';

const registry = new PlatformRegistry([
  new YouTubeProvider(), new XProvider(), new InstagramProvider({ cookiesFile: '' }), new TikTokProvider(),
  new RedditProvider(),
  new TwitchProvider(),
]);

const accepted = [
  ['youtube', 'https://www.youtube.com/watch?v=abcdefghijk'],
  ['x', 'https://x.com/example/status/123456789'],
  ['instagram', 'https://www.instagram.com/reel/Chunk8-jurw/?igsh=abc'],
  ['instagram', 'https://instagram.com/p/ABC_123/'],
  ['instagram', 'instagram.com/user.name/reels/ABC-123/'],
  ['instagram', 'https://www.instagram.com/tv/ABC123/'],
  ['instagram', '@user.name'],
  ['instagram', 'https://www.instagram.com/username/'],
  ['instagram', 'https://www.instagram.com/stories/user.name/'],
  ['instagram', 'https://www.instagram.com/stories/user.name/1234567890123456789/'],
  ['instagram', 'https://www.instagram.com/stories/highlights/1234567890123456789/'],
  ['tiktok', 'https://www.tiktok.com/@user.name/video/123456789?is_from_webapp=1'],
  ['tiktok', 'https://m.tiktok.com/@user/video/123456789'],
  ['tiktok', 'https://vm.tiktok.com/ABC123/'],
  ['tiktok', 'https://vt.tiktok.com/ABC123/?k=1'],
  ['tiktok', 'tiktok.com/t/ABC123/'],
  ['tiktok', 'https://www.tiktok.com/share/video/123456789'],
  ['tiktok', 'https://www.tiktok.com/embed/v2/123456789'],
  ['reddit', 'https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/'],
  ['reddit', 'https://old.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/'],
  ['reddit', 'https://www.reddit.com/user/example/comments/nip71r/a_video_post/'],
  ['reddit', 'https://www.reddit.com/comments/124pp33'],
  ['reddit', 'https://www.redditmedia.com/r/videos/comments/6rrwyj/a_video/'],
  ['reddit', 'https://www.reddit.com/r/videos/s/AbC_123'],
  ['reddit', 'https://redd.it/6rrwyj'],
  ['twitch', 'https://www.twitch.tv/videos/1234567890'],
  ['twitch', 'https://m.twitch.tv/example/video/1234567890?t=1h2m'],
  ['twitch', 'https://www.twitch.tv/example/v/1234567890'],
  ['twitch', 'https://player.twitch.tv/?video=v1234567890&parent=localhost'],
  ['twitch', 'https://clips.twitch.tv/FaintLightGullWholeWheat'],
  ['twitch', 'https://www.twitch.tv/example/clip/CulturedAmazingKudu-Example'],
  ['twitch', 'https://clips.twitch.tv/embed?clip=FaintLightGullWholeWheat&parent=localhost'],
];

for (const [platform, url] of accepted) {
  test(`frontend and registry accept ${url}`, () => {
    const provider = registry.findByUrl(` ${url} `);
    assert.equal(provider?.name, platform);
    assert.ok(SUPPORTED_PLATFORM_PATTERNS.some(pattern => pattern.test(url)));
    assert.ok(provider.supports(provider.normalizeUrl(url)));
  });
}

test('rejects unsupported profiles, Instagram routes and unrelated URLs', () => {
  for (const url of [
    '', null, {}, 'https://example.com/reel/ABC/',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/accounts/',
    'https://www.instagram.com/stories/',
    'https://www.instagram.com/stories/username/not-a-story-id/',
    'https://www.instagram.com/stories/username/123/extra/',
    'https://www.instagram.com/reels/audio/12345/',
    'https://www.tiktok.com/@username',
    'https://www.tiktok.com/@username/photo/12345',
    'https://www.reddit.com/r/videos/',
    'https://www.reddit.com/user/example/',
    'https://www.twitch.tv/example',
    'https://www.twitch.tv/example/videos',
    'https://www.twitch.tv/example/clips',
  ]) {
    assert.equal(registry.findByUrl(url), null);
  }
});

test('normalizes canonical TikTok links without modifying shortened links', () => {
  const provider = new TikTokProvider();
  assert.equal(provider.normalizeUrl(' tiktok.com/@user/video/123 '), 'https://www.tiktok.com/@user/video/123');
  assert.equal(provider.normalizeUrl('https://www.tiktok.com/embed/v2/123'), 'https://www.tiktok.com/embed/123');
  assert.equal(provider.normalizeUrl('https://vm.tiktok.com/ABC/?k=1'), 'https://vm.tiktok.com/ABC/?k=1');
});

test('YouTube metadata skips manifests without changing download extraction', () => {
  const provider = new YouTubeProvider();
  assert.deepEqual(provider.getInfoYtDlpArgs(), ['--extractor-args', 'youtube:skip=hls,dash']);
  assert.deepEqual(provider.getYtDlpArgs(), []);
});

test('Instagram metadata and download select a single carousel entry', () => {
  const provider = new InstagramProvider({ cookiesFile: '' });
  assert.deepEqual(provider.getInfoYtDlpArgs(), ['--ignore-config', '--yes-playlist', '--ignore-errors']);
  assert.deepEqual(provider.getYtDlpArgs(), ['--ignore-config', '--playlist-items', '1']);
  assert.deepEqual(provider.getYtDlpArgs({ playlistItem: 4 }), ['--ignore-config', '--playlist-items', '4']);
  assert.equal(
    provider.normalizeUrl('https://www.instagram.com/reel/DWCHxMDCFoe/?utm_source=copy&stkn=abc'),
    'https://www.instagram.com/reel/DWCHxMDCFoe/',
  );
  assert.equal(
    provider.normalizeUrl('instagram.com/user.name/reels/ABC-123/?img_index=4'),
    'https://www.instagram.com/reel/ABC-123/',
  );
  assert.deepEqual(new TikTokProvider().getYtDlpArgs(), []);
});

test('Reddit metadata and downloads select a single embedded video', () => {
  assert.deepEqual(new RedditProvider().getYtDlpArgs(), ['--playlist-items', '1']);
});

test('Twitch uses FFmpeg for player-compatible HLS downloads without burdening metadata extraction', () => {
  const provider = new TwitchProvider();
  assert.deepEqual(provider.getYtDlpArgs(), [
    '--downloader', 'm3u8:ffmpeg',
    '--downloader-args', 'ffmpeg:-progress pipe:2 -nostats',
  ]);
  assert.deepEqual(provider.getInfoYtDlpArgs(), []);
});
