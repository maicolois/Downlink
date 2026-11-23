import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMp4Target } from '@/server/services/mp4-target.js';

test('uses compatible output by default and only preserves an explicit original request', () => {
  assert.equal(resolveMp4Target(), 'compatible');
  assert.equal(resolveMp4Target({ requestedTarget: 'compatible' }), 'compatible');
  assert.equal(resolveMp4Target({ requestedTarget: 'other' }), 'compatible');
  assert.equal(resolveMp4Target({ requestedTarget: 'original', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'original');
});

test('unambiguous mobile signals keep compatible output even on a conflicting request', () => {
  for (const userAgent of ['iPhone', 'iPad', 'Android 14', 'Mozilla Mobile']) {
    assert.equal(resolveMp4Target({ requestedTarget: 'original', userAgent }), 'compatible');
  }
  assert.equal(resolveMp4Target({ requestedTarget: 'original', mobileHint: '?1' }), 'compatible');
  assert.equal(resolveMp4Target({ requestedTarget: 'original', userAgent: 'Macintosh', mobileHint: '?0' }), 'original');
});
