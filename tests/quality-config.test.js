import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIDEO_RESOLUTIONS,
  getDisplayResolution,
  getVideoResolutionDescription,
  getVideoResolutionLabel,
} from '@/shared/video-resolutions.js';
import { MP3_QUALITIES, getMp3BitrateFromQuality } from '@/shared/mp3-qualities.js';

test('manages common video resolution names from one shared source', () => {
  assert.deepEqual(VIDEO_RESOLUTIONS.map(quality => quality.resolution), [
    4320, 2160, 1440, 1080, 720, 480, 360, 240, 144,
  ]);
  assert.equal(getDisplayResolution(3840, 2160), 2160);
  assert.equal(getDisplayResolution(1080, 1920), 1080);
  assert.equal(getDisplayResolution(3600, 2026), 2160);
  assert.equal(getVideoResolutionLabel(2160), '2160p');
  assert.equal(getVideoResolutionDescription('2160p'), '4K');
  assert.equal(getVideoResolutionDescription('1080p'), 'Full HD');
});

test('keeps every current MP3 quality and resolves its bitrate', () => {
  assert.deepEqual(MP3_QUALITIES.map(quality => quality.kbps), [
    320, 256, 224, 192, 160, 128, 96, 80, 64, 48,
  ]);
  assert.equal(getMp3BitrateFromQuality('0'), 320);
  assert.equal(getMp3BitrateFromQuality('5'), 128);
  assert.equal(getMp3BitrateFromQuality('invalid'), 320);
});
