import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVideoInfo,
  parseVideoInfoCollection,
  getVideoDuration,
  getVideoFormats,
  getViewCount,
} from '@/server/platforms/common/video-metadata.js';

test('extracts carousel video metadata with parent fallbacks', () => {
  const info = parseVideoInfo(JSON.stringify({
    _type: 'playlist', title: 'Post', uploader: 'Author', thumbnail: 'cover.jpg',
    duration: 42, view_count: 12345,
    entries: [null, {
      id: 'first', title: 'First video', height: 1920, width: 1080, vcodec: 'h264',
    }],
  }));
  assert.equal(info.id, 'first');
  assert.equal(info.title, 'First video');
  assert.equal(info.uploader, 'Author');
  assert.equal(info.thumbnail, 'cover.jpg');
  assert.equal(info.duration, 42);
  assert.equal(info.view_count, 12345);
});

test('keeps every downloadable video and its original Instagram carousel index', () => {
  const videos = parseVideoInfoCollection(JSON.stringify({
    _type: 'playlist', title: 'Carousel', channel: 'creator', view_count: 900,
    entries: [
      { id: 'video-1', ext: 'mp4', vcodec: 'h264', playlist_index: 1 },
      null,
      { id: 'video-2', formats: [{ ext: 'mp4', vcodec: 'h264', height: 1080 }], playlist_index: 3 },
      { id: 'video-3', ext: 'mp4', vcodec: 'h264', playlist_index: 4 },
      null,
      { id: 'video-4', ext: 'mp4', vcodec: 'h264', playlist_index: 6 },
    ],
  }));

  assert.deepEqual(videos.map(video => video.id), ['video-1', 'video-2', 'video-3', 'video-4']);
  assert.deepEqual(videos.map(video => video.playlist_index), [1, 3, 4, 6]);
  assert.ok(videos.every(video => video.channel === 'creator'));
  assert.ok(videos.every(video => video.view_count === 900));
});

test('rejects an empty carousel and malformed metadata', () => {
  assert.throws(() => parseVideoInfo('{"entries":[]}'));
  assert.throws(() => parseVideoInfo('null'));
  assert.throws(() => parseVideoInfo('invalid json'));
});

test('retains real portrait resolutions and excludes audio-only formats', () => {
  const formats = getVideoFormats({ formats: [
    { vcodec: 'h264', width: 576, height: 1024 },
    { vcodec: 'h264', width: 1080, height: 1920, filesize: 5000 },
    { vcodec: 'hevc', width: 1080, height: 1920 },
    { vcodec: 'none', height: 2160 },
    { vcodec: 'h264', height: -1 },
  ] });
  assert.deepEqual(formats.map(format => format.height), [1920, 1024]);
  assert.equal(formats[0].label, '1080p');
  assert.equal(formats[0].filesize_approx, 5000);
});

test('uses simple orientation-independent quality labels', () => {
  assert.equal(getVideoFormats({ width: 1920, height: 1080, vcodec: 'h264' })[0].label, '1080p');
  assert.equal(getVideoFormats({ width: 3840, height: 2160, vcodec: 'h264' })[0].label, '2160p');
  assert.equal(getVideoFormats({ width: 2160, height: 3840, vcodec: 'h264' })[0].label, '2160p');
  assert.equal(getVideoFormats({
    width: 3600, height: 2026, format_note: '2160p', vcodec: 'h264',
  })[0].label, '2160p');
});

test('reads Instagram-compatible view count fields', () => {
  assert.equal(getViewCount({ view_count: 1200 }), 1200);
  assert.equal(getViewCount({ play_count: '3400' }), 3400);
  assert.equal(getViewCount({ video_view_count: 5600 }), 5600);
  assert.equal(getViewCount({ video_play_count: 6700 }), 6700);
  assert.equal(getViewCount({ ig_play_count: 7800 }), 7800);
  assert.equal(getViewCount({ statistics: { play_count: 8900 } }), 8900);
  assert.equal(getViewCount({}), null);
});

test('recovers Instagram duration from strings and encoded media metadata', () => {
  assert.equal(getVideoDuration({ duration_string: '1:02' }), 62);

  const metadata = Buffer.from(JSON.stringify({ duration_s: 17 })).toString('base64');
  assert.equal(getVideoDuration({
    formats: [{ url: `https://cdn.instagram.test/video.mp4?efg=${encodeURIComponent(metadata)}` }],
  }), 17);
  assert.equal(getVideoDuration({}), null);
});

test('unknown dimensions offer best available instead of invented resolutions', () => {
  assert.deepEqual(getVideoFormats({ formats: [{ vcodec: 'h264' }] }), [
    { height: 'best', label: 'Mejor disponible', filesize_approx: null },
  ]);
});
