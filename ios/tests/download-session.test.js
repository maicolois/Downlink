import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadSession, DOWNLOAD_SESSION_KEY } from '../public/js/download-session.js';

function fixture() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  let time = 1000;
  return { storage, advance: ms => { time += ms; }, session: createDownloadSession(() => storage, () => time) };
}

const record = {
  jobId: 'c6846b30-7510-48dc-9e97-6fed5873ee09', format: 'mp4', quality: '720',
  video: { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Prueba',
    thumbnail: 'https://example.com/thumb.jpg', duration: 60, platform: 'youtube' },
};

test('download reference survives reopening, expires, and contains no account secrets', () => {
  const { storage, session, advance } = fixture();
  session.save({ ...record, token: 'secret', video: { ...record.video, cookies: 'secret' } });
  assert.equal(session.load().jobId, record.jobId);
  assert.equal(storage.getItem(DOWNLOAD_SESSION_KEY).includes('secret'), false);
  advance(4 * 60 * 60 * 1000);
  assert.equal(session.load(), null);
  assert.equal(storage.getItem(DOWNLOAD_SESSION_KEY), null);
});

test('legacy downloads recover without a profile and only the matching job is cleared', () => {
  const { storage, session } = fixture();
  storage.setItem(DOWNLOAD_SESSION_KEY, JSON.stringify({ ...record, createdAt: 1000, profileId: 'owner' }));
  assert.equal(session.load().jobId, record.jobId);
  assert.equal(Object.hasOwn(session.load(), 'profileId'), false);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(DOWNLOAD_SESSION_KEY)), 'profileId'), false);
  assert.equal(storage.getItem('downlink.activeProfileId.v1'), null);
  session.clear('another-job');
  assert.ok(session.load());
  session.clear(record.jobId);
  assert.equal(session.load(), null);
});

test('corrupt, expired, unsafe and missing storage cannot break startup', () => {
  const { storage, session } = fixture();
  storage.setItem(DOWNLOAD_SESSION_KEY, '{broken');
  assert.equal(session.load(), null);
  for (const invalid of [
    { ...record, jobId: '../private' }, { ...record, format: 'exe' },
    { ...record, video: { url: 'javascript:alert(1)' } },
    { ...record, quality: '<img>' },
  ]) {
    storage.removeItem(DOWNLOAD_SESSION_KEY);
    session.save(invalid);
    assert.equal(session.load(), null);
  }
  const blocked = createDownloadSession(() => { throw new Error('Storage blocked'); });
  assert.doesNotThrow(() => blocked.save(record));
  assert.equal(blocked.load(), null);
  assert.doesNotThrow(() => blocked.clear());
});
