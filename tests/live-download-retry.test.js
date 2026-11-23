import test from 'node:test';
import assert from 'node:assert/strict';
import { isRefreshableLiveFragmentError, isTerminalLiveDownloadError, runLiveDownloadWithRetry } from '@/server/services/live-download-retry.js';

test('retries a failed live download with the same arguments and bounded backoff', async () => {
  const args = Object.freeze(['--load-info-json', 'snapshot.json', '-o', 'same-output']);
  const seen = [], waits = [], notices = [];
  const result = await runLiveDownloadWithRetry(async () => {
    seen.push(args);
    if (seen.length < 3) throw new Error('yt-dlp exited with code 1');
    return 'done';
  }, { sleep: async ms => waits.push(ms), onRetry: ({ attempt }) => notices.push(attempt) });
  assert.equal(result, 'done');
  assert.deepEqual(seen, [args, args, args]);
  assert.deepEqual(waits, [1000, 2000]);
  assert.deepEqual(notices, [1, 2]);
});

test('stops after two retries and returns the last failure', async () => {
  let calls = 0;
  const error = new Error('temporary unknown error');
  await assert.rejects(runLiveDownloadWithRetry(async () => { calls++; throw error; }, {
    sleep: async () => {},
  }), value => value === error);
  assert.equal(calls, 3);
});

test('terminal failures never retry, including auth, missing resources and processing errors', async () => {
  for (const message of [
    'ERROR: HTTP Error 403: Forbidden',
    'ERROR: Postprocessing: ffmpeg exited with code 1', 'No space left on device',
    'Sign in to confirm your age', 'Requested format is not available',
  ]) {
    let calls = 0;
    await assert.rejects(runLiveDownloadWithRetry(async () => { calls++; throw new Error(message); }, {
      sleep: async () => assert.fail('terminal errors must not sleep'),
    }));
    assert.equal(calls, 1, message);
  }
  assert.equal(isTerminalLiveDownloadError(new Error('ERROR: fragment 403 failed after 10 retries')), false);
  assert.equal(isTerminalLiveDownloadError(new Error('ERROR: HTTP Error 404: Not Found')), false);
  assert.equal(isTerminalLiveDownloadError(new Error('ERROR: HTTP Error 503: Service Unavailable')), false);
});

test('cancellation during backoff prevents another attempt', async () => {
  let cancelled = false, calls = 0;
  const cancellation = Object.assign(new Error('cancelled'), { code: 'JOB_CANCELLED' });
  await assert.rejects(runLiveDownloadWithRetry(async () => { calls++; throw new Error('transient'); }, {
    checkCancelled: () => { if (cancelled) throw cancellation; },
    sleep: async () => { cancelled = true; },
  }), value => value === cancellation);
  assert.equal(calls, 1);
});

test('live URL refresh retries continue only while making progress and have an absolute limit', async () => {
  let progress = 0, calls = 0, refreshes = 0;
  const unauthorized = new Error('ERROR: fragment 4307 not found, HTTP Error 401');
  assert.equal(isRefreshableLiveFragmentError(unauthorized), true);
  await assert.rejects(runLiveDownloadWithRetry(async () => {
    calls++;
    if (calls <= 4) progress += 100;
    throw unauthorized;
  }, {
    maxTotalRetries: 20,
    getProgress: () => progress,
    shouldRetry: isRefreshableLiveFragmentError,
    onRetry: () => { refreshes++; },
    sleep: async () => {},
  }), error => error === unauthorized);
  assert.equal(calls, 6, 'stops after two retries with no further progress');
  assert.equal(refreshes, 5);

  progress = 0; calls = 0;
  await assert.rejects(runLiveDownloadWithRetry(async () => { calls++; progress++; throw unauthorized; }, {
    maxTotalRetries: 4, getProgress: () => progress,
    shouldRetry: isRefreshableLiveFragmentError, sleep: async () => {},
  }), error => error === unauthorized);
  assert.equal(calls, 5, 'a hard limit prevents endless refreshes even with progress');
});
