import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createYouTubeLiveSnapshot, refreshYouTubeLiveSnapshot } from '@/server/platforms/youtube/youtube-live-snapshot.js';

const info = () => ({
  id: 'livefixture', live_status: 'is_live', is_live: true, release_timestamp: 1000,
  formats: [
    { format_id: 'v', protocol: 'http_dash_segments_generator', url: 'https://a.googlevideo.com/video?token=secret', vcodec: 'avc1' },
    { format_id: 'a', protocol: 'http_dash_segments_generator', url: 'https://b.googlevideo.com/video?token=secret', vcodec: 'none' },
    { format_id: 'other', protocol: 'm3u8', url: 'https://example.com/' },
  ],
});

test('refreshes signed URLs without changing frozen fragment lists or cutoff', async () => {
  const snapshot = await createYouTubeLiveSnapshot(info(), {
    now: () => 1001 * 1000,
    fetchImpl: async () => new Response(null, { headers: { 'x-head-seqnum': '2' } }),
  });
  try {
    const before = JSON.parse(await readFile(snapshot.infoFile, 'utf8'));
    const fresh = info();
    fresh.formats[0].url = 'https://fresh.googlevideo.com/video?token=renewed';
    fresh.formats[0].http_headers = { 'User-Agent': 'refreshed' };
    fresh.formats[1].url = 'https://fresh.googlevideo.com/audio?token=other';
    await refreshYouTubeLiveSnapshot(snapshot.infoFile, JSON.stringify(fresh));
    const after = JSON.parse(await readFile(snapshot.infoFile, 'utf8'));
    assert.deepEqual(after.formats.map(f => f.fragments), before.formats.map(f => f.fragments));
    assert.equal(after.formats[0].extra_param_to_segment_url, 'token=renewed');
    assert.equal(after.formats[0].fragment_base_url, 'https://fresh.googlevideo.com/video');
    assert.deepEqual(after.formats[0].http_headers, { 'User-Agent': 'refreshed' });
    assert.equal(after.formats[1].extra_param_to_segment_url, 'token=other');
    assert.equal(after.live_status, 'was_live');
  } finally { await snapshot.cleanup(); }
});

test('rejects unsafe or missing refreshed formats without modifying the snapshot', async () => {
  const snapshot = await createYouTubeLiveSnapshot(info(), {
    now: () => 1001 * 1000,
    fetchImpl: async () => new Response(null, { headers: { 'x-head-seqnum': '2' } }),
  });
  try {
    const original = await readFile(snapshot.infoFile, 'utf8');
    for (const modify of [
      fresh => { fresh.id = 'other'; },
      fresh => { fresh.formats[0].url = 'https://evil.example/?token=secret'; },
      fresh => { fresh.formats.splice(1, 1); },
      fresh => { fresh.formats.push({ ...fresh.formats[0] }); },
    ]) {
      const fresh = info(); modify(fresh);
      await assert.rejects(refreshYouTubeLiveSnapshot(snapshot.infoFile, fresh), error =>
        error.code === 'YOUTUBE_LIVE_SNAPSHOT_FAILED' && !error.message.includes('secret'));
      assert.equal(await readFile(snapshot.infoFile, 'utf8'), original);
    }
    await assert.rejects(refreshYouTubeLiveSnapshot(snapshot.infoFile, info(), {
      checkCancelled: () => { throw Object.assign(new Error('cancelled'), { code: 'JOB_CANCELLED' }); },
    }), { code: 'JOB_CANCELLED' });
    assert.equal(await readFile(snapshot.infoFile, 'utf8'), original);
  } finally { await snapshot.cleanup(); }
});

test('freezes both tracks at their common live edge and removes temporary data', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, 'HEAD');
    assert.equal(options.redirect, 'error');
    return new Response(null, { headers: { 'x-head-seqnum': url.hostname === 'a.googlevideo.com' ? '3' : '2' } });
  };
  const snapshot = await createYouTubeLiveSnapshot(info(), { now: () => 1001 * 1000, fetchImpl });
  try {
    const frozen = JSON.parse(await readFile(snapshot.infoFile, 'utf8'));
    assert.equal(frozen.is_live, false);
    assert.deepEqual(frozen.formats.map(f => f.format_id), ['v', 'a']);
    for (const f of frozen.formats) {
      assert.equal(f.protocol, 'http_dash_segments');
      assert.equal(f.extra_param_to_segment_url, 'token=secret');
      assert.deepEqual(f.fragments.map(fragment => fragment.path), ['?sq=0', '?sq=1', '?sq=2']);
    }
    if (process.platform !== 'win32') assert.equal((await stat(snapshot.infoFile)).mode & 0o777, 0o600);
  } finally {
    await snapshot.cleanup();
  }
  await assert.rejects(stat(snapshot.infoFile), { code: 'ENOENT' });
});

test('rejects missing live edges and avoids leaking signed URLs', async () => {
  await assert.rejects(
    createYouTubeLiveSnapshot(info(), { now: () => 1001 * 1000, fetchImpl: async () => { throw new Error('https://a.googlevideo.com/?token=secret'); } }),
    error => error.code === 'YOUTUBE_LIVE_SNAPSHOT_FAILED' && !error.message.includes('secret'),
  );
  await assert.rejects(
    createYouTubeLiveSnapshot(info(), { now: () => 1001 * 1000, fetchImpl: async () => new Response(null) }),
    { code: 'YOUTUBE_LIVE_SNAPSHOT_FAILED' },
  );
});

test('rejects invalid hosts, excessive snapshots and cancellation', async () => {
  const bad = info();
  bad.formats[0].url = 'https://notgooglevideo.com/';
  await assert.rejects(createYouTubeLiveSnapshot(bad, { now: () => 1001 * 1000 }), { code: 'YOUTUBE_LIVE_SNAPSHOT_FAILED' });
  await assert.rejects(createYouTubeLiveSnapshot(info(), {
    now: () => 1001 * 1000,
    fetchImpl: async () => new Response(null, { headers: { 'x-head-seqnum': '1000000' } }),
  }), { code: 'YOUTUBE_LIVE_SNAPSHOT_FAILED' });
  await assert.rejects(createYouTubeLiveSnapshot(info(), {
    checkCancelled: () => { throw Object.assign(new Error('cancelled'), { code: 'JOB_CANCELLED' }); },
  }), { code: 'JOB_CANCELLED' });
});
