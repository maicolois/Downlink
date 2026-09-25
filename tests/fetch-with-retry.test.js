import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../public/js/fetch-with-retry.js';

test('retries the first transient fetch failure once', async () => {
  const response = { ok: true };
  let calls = 0;
  let waits = 0;

  const result = await fetchWithRetry('/api/info', { method: 'POST' }, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return response;
    },
    waitImpl: async milliseconds => {
      waits += 1;
      assert.equal(milliseconds, 300);
    },
  });

  assert.equal(result, response);
  assert.equal(calls, 2);
  assert.equal(waits, 1);
});

test('does not retry HTTP responses or application errors', async () => {
  let httpCalls = 0;
  const httpResponse = await fetchWithRetry('/api/info', {}, {
    fetchImpl: async () => {
      httpCalls += 1;
      return { ok: false, status: 500 };
    },
  });
  assert.equal(httpResponse.status, 500);
  assert.equal(httpCalls, 1);

  let applicationCalls = 0;
  await assert.rejects(fetchWithRetry('/api/info', {}, {
    fetchImpl: async () => {
      applicationCalls += 1;
      throw new Error('invalid request');
    },
  }), /invalid request/);
  assert.equal(applicationCalls, 1);
});
