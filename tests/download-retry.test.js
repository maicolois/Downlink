import test from 'node:test';
import assert from 'node:assert/strict';
import { retryRetainedDownload } from '@/public/js/download-retry.js';

test('retries the same retained job when the user requests it', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return url.startsWith('/api/status/')
      ? Response.json({ status: 'error', retryable: true })
      : Response.json({ jobId: 'same-job' });
  };
  await retryRetainedDownload('same-job', { request, headers: { 'X-Test': 'auth' } });
  assert.deepEqual(calls.map(call => call.url), ['/api/status/same-job', '/api/retry/same-job']);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['X-Test'], 'auth');
});

test('does not start a second worker when the previous retry is already running', async () => {
  for (const state of ['starting', 'downloading', 'converting', 'ready']) {
    const calls = [];
    await retryRetainedDownload('job', { request: async url => {
      calls.push(url);
      return Response.json({ status: state });
    } });
    assert.deepEqual(calls, ['/api/status/job']);
  }
});

test('distinguishes expired jobs from temporary retry request failures', async () => {
  await assert.rejects(retryRetainedDownload('job', { request: async () => new Response('', { status: 404 }) }),
    { permanent: true });
  let requests = 0;
  await assert.rejects(retryRetainedDownload('job', { request: async () => {
    if (++requests === 1) return Response.json({ status: 'error', retryable: true });
    return Response.json({ error: 'Servidor ocupado' }, { status: 503 });
  } }), { message: 'Servidor ocupado', permanent: false });
  await assert.rejects(retryRetainedDownload('job', { request: async () => Response.json({ status: 'error', retryable: false }) }),
    { permanent: true });
});
