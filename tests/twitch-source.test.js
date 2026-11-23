import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveTwitchPlaylist, TwitchProvider } from '@/server/platforms/twitch/twitch-provider.js';
import { deriveTwitchSourceUrl, probeTwitchSource } from '@/server/platforms/twitch/twitch-source.js';
import { getVideoFormats } from '@/server/platforms/common/video-metadata.js';
import { buildMp4FormatSelector } from '@/server/services/mp4-compatibility.js';

const advertisedUrl = 'https://video-edge.example/channel/vod/1080p60/index-muted-token.m3u8';
const sourceUrl = 'https://video-edge.example/channel/vod/chunked/index-muted-token.m3u8';
const root = fileURLToPath(new URL('../', import.meta.url));
const ytDlp = process.env.YT_DLP_PATH || path.join(root, 'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp');

test('yt-dlp can select a direct media playlist with unknown height', {
  skip: fs.existsSync(ytDlp) ? false : 'Install the bundled yt-dlp to run selection integration tests',
  timeout: 20_000,
}, async () => {
  const playlist = await serveTwitchPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttps://example.invalid/0.ts\n#EXT-X-ENDLIST\n');
  const select = quality => new Promise((resolve, reject) => {
    const child = spawn(ytDlp, ['--ignore-config', '--no-warnings', '--simulate', '-f',
      buildMp4FormatSelector(quality), '--print', '%(format_id)s', playlist.url], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
  try {
    const filtered = await select('720');
    assert.notEqual(filtered.status, 0);
    assert.match(filtered.stderr, /requested format is not available/i);
    const preselected = await select('best');
    assert.equal(preselected.status, 0, preselected.stderr);
    assert.ok(preselected.stdout.trim());
  } finally {
    await playlist.cleanup();
  }
});

test('serves prepared Twitch playlists over loopback without filesystem path restrictions', async () => {
  const playlist = '#EXTM3U\n#EXT-X-ENDLIST\n';
  const served = await serveTwitchPlaylist(playlist, 'job in a folder with spaces');
  try {
    const url = new URL(served.url);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.protocol, 'http:');
    assert.equal(await (await fetch(served.url)).text(), playlist);
    assert.equal((await fetch(new URL('/other.m3u8', served.url))).status, 404);
  } finally {
    await served.cleanup();
  }
});

test('freezes a Twitch event and keeps its duration even when unmuting changes nothing', async () => {
  let body = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:10,\n0.ts\n#EXTINF:9,\n1.ts\n';
  const server = createServer((_req, res) => res.end(body));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/index-dvr.m3u8`;
  const provider = new TwitchProvider();
  let prepared;
  try {
    prepared = await provider.prepareDownload({
      url, format: 'mp4', quality: '1080', video: { videoFormats: [{ height: 1080, sourceUrl: url }] },
    });
    body += '#EXTINF:10,\n2.ts\n';
    const frozen = await (await fetch(prepared.url)).text();
    assert.equal(prepared.duration, 19);
    assert.match(frozen, /#EXT-X-ENDLIST\s*$/);
    assert.match(frozen, /\/1\.ts/);
    assert.doesNotMatch(frozen, /\/2\.ts/);
    assert.deepEqual(prepared.ytDlpArgs, []);
    assert.equal(prepared.qualityPreselected, true);
  } finally {
    await prepared?.cleanup?.();
    await new Promise(resolve => server.close(resolve));
  }
});

test('does not fall back to an unbounded Twitch stream when its playlist cannot be fetched', async () => {
  const server = createServer((_req, res) => { res.writeHead(503); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/index-dvr.m3u8`;
  try {
    await assert.rejects(new TwitchProvider().prepareDownload({
      url, format: 'mp4', quality: '1080', video: { videoFormats: [{ height: 1080, sourceUrl: url }] },
    }), /No se pudo preparar la lista de fragmentos/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('rejects Twitch VOD downloads without a snapshot-capable media playlist', async () => {
  const provider = new TwitchProvider();
  for (const url of ['https://www.twitch.tv/videos/123', 'https://m.twitch.tv/channel/v/123', 'https://player.twitch.tv/?video=v123']) {
    await assert.rejects(provider.prepareDownload({ url, format: 'mp4', quality: '1080', video: { videoFormats: [] } }), /lista de fragmentos/);
  }
  const clip = 'https://clips.twitch.tv/ExampleClip';
  const clipDownload = await provider.prepareDownload({ url: clip, format: 'mp4' });
  assert.equal(clipDownload.url, clip);
  assert.equal(clipDownload.qualityPreselected, undefined);
});

test('derives Twitch source playlists from the best advertised HLS rendition', () => {
  assert.equal(deriveTwitchSourceUrl([
    { height: 720, protocol: 'm3u8_native', url: advertisedUrl.replace('1080p60', '720p60') },
    { height: 1080, protocol: 'm3u8_native', url: advertisedUrl },
  ]), sourceUrl);
  assert.equal(deriveTwitchSourceUrl([{ protocol: 'https', url: 'https://example.com/video.mp4' }]), null);
});

test('probes the hidden Twitch source and exposes its real resolution and codecs', async () => {
  const spawnImpl = (_executable, args) => {
    assert.equal(args.at(-1), sourceUrl);
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.kill = () => true;
    queueMicrotask(() => {
      proc.stdout.end(JSON.stringify({ streams: [
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'video', codec_name: 'hevc', width: 2560, height: 1440, avg_frame_rate: '60/1' },
      ] }));
      proc.emit('close', 0);
    });
    return proc;
  };

  assert.deepEqual(await probeTwitchSource([
    { height: 1080, protocol: 'm3u8_native', url: advertisedUrl },
  ], { spawnImpl, ffprobePath: 'fixture-ffprobe' }), {
    format_id: 'chunked', format_note: 'Source', url: sourceUrl, protocol: 'm3u8_native', ext: 'mp4',
    width: 2560, height: 1440, fps: 60, vcodec: 'hevc', acodec: 'aac', is_downlink_source: true,
  });
});

test('adds a distinct hidden source and routes only its MP4 selection to the direct playlist', async () => {
  const provider = new TwitchProvider({
    sourceProbe: async () => ({
      format_id: 'chunked', format_note: 'Source', url: sourceUrl, protocol: 'm3u8_native', ext: 'mp4',
      width: 2560, height: 1440, fps: 60, vcodec: 'hevc', acodec: 'aac', is_downlink_source: true,
    }),
  });
  const [enriched] = await provider.enrichVideoInfos([{ formats: [
    { height: 1080, width: 1920, vcodec: 'h264', url: advertisedUrl },
  ] }]);
  const videoFormats = getVideoFormats(enriched);

  assert.deepEqual(videoFormats.map(format => format.height), [1440, 1080]);
  assert.equal(videoFormats[0].label, '1440p');
  assert.equal(videoFormats[0].sourceUrl, sourceUrl);
  assert.equal(videoFormats[0].vcodec, 'hevc');
  assert.equal(videoFormats[1].sourceUrl, advertisedUrl);
  assert.equal(videoFormats[1].vcodec, 'h264');
  assert.deepEqual(provider.getYtDlpArgs({
    format: 'mp4', quality: '1440', video: { videoFormats },
  }), [
    '--downloader', 'm3u8:ffmpeg',
    '--downloader-args', 'ffmpeg:-progress pipe:2 -nostats -tag:v hvc1',
  ]);
  assert.equal(provider.getDownloadUrl({
    url: 'https://www.twitch.tv/videos/1', format: 'mp4', quality: '1440', video: { videoFormats },
  }), sourceUrl);
  assert.equal(provider.getDownloadUrl({
    url: 'https://www.twitch.tv/videos/1', format: 'mp3', quality: '0', video: { videoFormats },
  }), sourceUrl);
});

test('routes Twitch MP3 and advertised MP4 qualities through direct media playlists', async () => {
  const audioUrl = advertisedUrl.replace('/1080p60/', '/audio_only/');
  const provider = new TwitchProvider({ sourceProbe: async () => null });
  const [enriched] = await provider.enrichVideoInfos([{ formats: [
    { format_id: 'Audio_Only', vcodec: 'none', acodec: 'aac', url: audioUrl },
    { format_id: '1080p60', width: 1920, height: 1080, vcodec: 'h264', acodec: 'aac', url: advertisedUrl },
  ] }]);
  const video = {
    audioSourceUrl: enriched.downlink_audio_url,
    videoFormats: getVideoFormats(enriched),
  };

  assert.equal(video.audioSourceUrl, audioUrl);
  assert.equal(provider.getDownloadUrl({
    url: 'https://www.twitch.tv/videos/1', format: 'mp3', quality: '320', video,
  }), video.audioSourceUrl);
  assert.equal(provider.getDownloadUrl({
    url: 'https://www.twitch.tv/videos/1', format: 'mp4', quality: '1080', video,
  }), advertisedUrl);
  assert.equal(provider.getDownloadUrl({
    url: 'https://www.twitch.tv/videos/1', format: 'mp4', quality: 'best', video,
  }), advertisedUrl);
});
