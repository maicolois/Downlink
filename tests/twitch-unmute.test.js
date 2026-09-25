import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTwitchUnmutedPlaylist } from '../server/platforms/twitch/twitch-unmute.js';

const high = 'https://video-edge.example/vod/1080p60/index-muted-token.m3u8';
const low = 'https://video-edge.example/vod/720p60/index-muted-token.m3u8';
const audio = 'https://video-edge.example/vod/audio_only/index-dvr.m3u8';

function mockResponse(status, body = '', headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: { get: name => headers[String(name).toLowerCase()] ?? null },
    body: { cancel: async () => {} },
  };
}

function createFetch(routes) {
  return async (url, options = {}) => {
    const key = `${options.method || 'GET'} ${url}`;
    return routes.get(key) || routes.get(String(url)) || mockResponse(403);
  };
}

test('replaces each marked fragment like the extension and falls back to a lower quality', async () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init-0.mp4"',
    '#EXTINF:10.000,',
    '0-muted.mp4',
    '#EXTINF:10.000,',
    '1.mp4',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const routes = new Map([
    [high, mockResponse(200, playlist)],
    ['https://video-edge.example/vod/720p60/0.mp4', mockResponse(200)],
  ]);

  const result = await buildTwitchUnmutedPlaylist({
    playlistUrl: high,
    candidatePlaylistUrls: [high, low],
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.mutedCount, 1);
  assert.equal(result.replacedCount, 1);
  assert.match(result.playlist, /https:\/\/video-edge\.example\/vod\/720p60\/0\.mp4/);
  assert.match(result.playlist, /URI="https:\/\/video-edge\.example\/vod\/1080p60\/init-0\.mp4"/);
  assert.match(result.playlist, /https:\/\/video-edge\.example\/vod\/1080p60\/1\.mp4/);
  assert.doesNotMatch(result.playlist, /-muted\./);
});

test('accepts Twitch current -unmuted fragment variant when the plain original is gone', async () => {
  const playlist = '#EXTM3U\n#EXTINF:10.000,\n3185-muted.mp4\n#EXT-X-ENDLIST';
  const replacement = 'https://video-edge.example/vod/1080p60/3185-unmuted.mp4';
  const result = await buildTwitchUnmutedPlaylist({
    playlistUrl: high,
    fetchImpl: createFetch(new Map([
      [high, mockResponse(200, playlist)],
      [replacement, mockResponse(200)],
    ])),
  });

  assert.match(result.playlist, /3185-unmuted\.mp4/);
});

test('prefers the FFmpeg-readable -unmuted variant over a cache-only plain original', async () => {
  const playlist = '#EXTM3U\n#EXTINF:10.000,\n1278-muted.mp4\n#EXT-X-ENDLIST';
  const original = 'https://video-edge.example/vod/1080p60/1278.mp4';
  const unmuted = 'https://video-edge.example/vod/1080p60/1278-unmuted.mp4';
  const result = await buildTwitchUnmutedPlaylist({
    playlistUrl: high,
    fetchImpl: createFetch(new Map([
      [high, mockResponse(200, playlist)],
      [original, mockResponse(200)],
      [unmuted, mockResponse(200)],
    ])),
  });

  assert.match(result.playlist, /1278-unmuted\.mp4/);
});

test('replaces recoverable fragments and keeps unavailable ones without cancelling', async () => {
  const playlist = [
    '#EXTM3U',
    '#EXTINF:10.000,',
    '0-muted.mp4',
    '#EXTINF:10.000,',
    '1-muted.mp4',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const recovered = 'https://video-edge.example/vod/1080p60/0.mp4';
  const result = await buildTwitchUnmutedPlaylist({
    playlistUrl: high,
    fetchImpl: createFetch(new Map([
      [high, mockResponse(200, playlist)],
      [recovered, mockResponse(200)],
    ])),
  });

  assert.equal(result.changed, true);
  assert.equal(result.replacedCount, 1);
  assert.equal(result.unavailableCount, 1);
  assert.match(result.playlist, /https:\/\/video-edge\.example\/vod\/1080p60\/0\.mp4/);
  assert.match(result.playlist, /https:\/\/video-edge\.example\/vod\/1080p60\/1-muted\.mp4/);
});

test('keeps Twitch audio and continues when the preserved DVR fragment was deleted', async () => {
  const dvr = 'https://video-edge.example/vod/1080p60/index-dvr.m3u8';
  const videoPlaylist = '#EXTM3U\n#EXTINF:10.000,\n0.mp4\n#EXT-X-ENDLIST';
  const audioPlaylist = '#EXTM3U\n#EXTINF:10.000,\n0.mp4\n#EXT-X-ENDLIST';
  const routes = new Map([
    [dvr, mockResponse(200, videoPlaylist)],
    [audio, mockResponse(200, audioPlaylist)],
    [`HEAD https://video-edge.example/vod/audio_only/0.mp4`, mockResponse(200, '', { 'content-length': '17410' })],
  ]);

  const result = await buildTwitchUnmutedPlaylist({
    playlistUrl: dvr,
    audioPlaylistUrl: audio,
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.changed, false);
  assert.equal(result.mutedCount, 1);
  assert.equal(result.replacedCount, 0);
  assert.equal(result.unavailableCount, 1);
  assert.match(result.playlist, /0\.mp4/);
});

test('replaces silent DVR audio when the preserved -unmuted asset still exists', async () => {
  const dvr = 'https://video-edge.example/vod/1080p60/index-dvr.m3u8';
  const playlist = '#EXTM3U\n#EXTINF:10.000,\n0.mp4\n#EXT-X-ENDLIST';
  const replacement = 'https://video-edge.example/vod/1080p60/0-unmuted.mp4';
  const routes = new Map([
    [dvr, mockResponse(200, playlist)],
    [audio, mockResponse(200, playlist)],
    [`HEAD https://video-edge.example/vod/audio_only/0.mp4`, mockResponse(200, '', { 'content-length': '17410' })],
    [replacement, mockResponse(200)],
  ]);

  const result = await buildTwitchUnmutedPlaylist({
    playlistUrl: dvr,
    audioPlaylistUrl: audio,
    fetchImpl: createFetch(routes),
  });
  assert.match(result.playlist, /0-unmuted\.mp4/);
});
