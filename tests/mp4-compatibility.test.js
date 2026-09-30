import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppleCompatibleMp4Args,
  buildCompatibleMp4FormatSelector,
  inspectAppleMp4Compatibility,
} from '@/server/services/mp4-compatibility.js';

test('prefers H.264 and AAC while retaining a generic format fallback', () => {
  const selector = buildCompatibleMp4FormatSelector('1080');
  assert.match(selector, /bestvideo\[height<=1080\]\[vcodec\^=avc1\]\+bestaudio\[ext=m4a\]/);
  assert.match(selector, /bestvideo\[height<=1080\]\+bestaudio/);
  assert.match(selector, /\/best$/);
});

test('recognizes an iPhone-compatible H.264 and AAC MP4', () => {
  const result = inspectAppleMp4Compatibility([
    { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
    { codec_type: 'audio', codec_name: 'aac' },
  ]);

  assert.equal(result.compatible, true);
  assert.equal(result.needsVideoTranscode, false);
  assert.equal(result.needsAudioTranscode, false);
});

test('transcodes AV1 and Opus to H.264 and AAC', () => {
  const { args, compatibility } = buildAppleCompatibleMp4Args({
    inputPath: 'source.mp4',
    outputPath: 'compatible.mp4',
    streams: [
      { codec_type: 'video', codec_name: 'av1', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'opus' },
    ],
  });

  assert.equal(compatibility.compatible, false);
  assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'libx264']);
  assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2), ['-c:a', 'aac']);
  assert.deepEqual(args.slice(args.indexOf('-movflags'), args.indexOf('-movflags') + 2), ['-movflags', '+faststart']);
});

test('copies compatible tracks while rebuilding the MP4 for fast start', () => {
  const { args } = buildAppleCompatibleMp4Args({
    inputPath: 'source.mp4',
    outputPath: 'compatible.mp4',
    streams: [
      { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });

  assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'copy']);
  assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2), ['-c:a', 'copy']);
});

test('rejects an audio-only result for an MP4 request', () => {
  assert.throws(() => buildAppleCompatibleMp4Args({
    inputPath: 'source.mp4',
    outputPath: 'compatible.mp4',
    streams: [{ codec_type: 'audio', codec_name: 'aac' }],
  }), /no contiene una pista de vídeo/);
});
