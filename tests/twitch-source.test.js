import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { TwitchProvider } from '../server/platforms/twitch/twitch-provider.js';
import { deriveTwitchSourceUrl, probeTwitchSource } from '../server/platforms/twitch/twitch-source.js';
import { getVideoFormats } from '../server/platforms/common/video-metadata.js';

const advertisedUrl = 'https://video-edge.example/channel/vod/1080p60/index-muted-token.m3u8';
const sourceUrl = 'https://video-edge.example/channel/vod/chunked/index-muted-token.m3u8';

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
  }), 'https://www.twitch.tv/videos/1');
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
