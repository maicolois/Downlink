import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichInstagramViewCounts } from '@/server/platforms/instagram/instagram-view-count.js';

function response({ ok = true, cookies = [], payload = {} } = {}) {
  return {
    ok,
    headers: { getSetCookie: () => cookies },
    json: async () => payload,
  };
}

test('recovers an omitted Instagram Reel play count from the clips connection', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return response({ cookies: ['csrftoken=test-token; Path=/; Secure'] });
    }
    return response({
      payload: {
        data: {
          xdt_api__v1__clips__user__connection_v2: {
            edges: [{ node: { media: { code: 'DdFVPyjCB1J', play_count: 158230 } } }],
          },
        },
      },
    });
  };
  const infos = [{
    id: 'DdFVPyjCB1J',
    uploader_id: '72822996363',
    webpage_url: 'https://www.instagram.com/reel/DdFVPyjCB1J/',
  }];

  const enriched = await enrichInstagramViewCounts(infos, { fetchImpl });

  assert.equal(enriched[0].video_play_count, 158230);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['x-csrftoken'], 'test-token');
  assert.match(String(calls[1].options.body), /27234427476213202/);
});

test('keeps an extractor-provided count and skips the fallback request', async () => {
  let called = false;
  const infos = [{ id: 'reel', uploader_id: '1', view_count: 42 }];
  const result = await enrichInstagramViewCounts(infos, {
    fetchImpl: async () => {
      called = true;
      return response();
    },
  });

  assert.equal(result, infos);
  assert.equal(called, false);
});

test('paginates the clips connection until it finds an older Reel', async () => {
  const requestBodies = [];
  const fetchImpl = async (url, options = {}) => {
    if (!options.method) {
      return response({ cookies: ['csrftoken=test-token; Path=/; Secure'] });
    }

    const body = new URLSearchParams(options.body);
    const variables = JSON.parse(body.get('variables'));
    requestBodies.push(variables.data);
    if (!variables.data.max_id) {
      return response({
        payload: {
          data: {
            xdt_api__v1__clips__user__connection_v2: {
              edges: [{ node: { media: { code: 'newer-reel', play_count: 10 } } }],
              page_info: { has_next_page: true, end_cursor: 'next-page' },
            },
          },
        },
      });
    }

    return response({
      payload: {
        data: {
          xdt_api__v1__clips__user__connection_v2: {
            edges: [{ node: { media: { code: 'older-reel', play_count: 98765 } } }],
            page_info: { has_next_page: true, end_cursor: 'unused-page' },
          },
        },
      },
    });
  };
  const result = await enrichInstagramViewCounts([{
    id: 'older-reel',
    uploader_id: '123',
    webpage_url: 'https://www.instagram.com/reel/older-reel/',
  }], { fetchImpl });

  assert.equal(result[0].video_play_count, 98765);
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[1].max_id, 'next-page');
});

test('reuses the Instagram session and cached pages for another Reel by the same author', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) {
      return response({ cookies: ['csrftoken=test-token; Path=/; Secure'] });
    }
    return response({
      payload: {
        data: {
          xdt_api__v1__clips__user__connection_v2: {
            edges: [
              { node: { media: { code: 'reel-one', play_count: 100 } } },
              { node: { media: { code: 'reel-two', play_count: 200 } } },
            ],
            page_info: { has_next_page: false, end_cursor: null },
          },
        },
      },
    });
  };

  const first = await enrichInstagramViewCounts([{
    id: 'reel-one', uploader_id: 'same-user',
  }], { fetchImpl });
  const second = await enrichInstagramViewCounts([{
    id: 'reel-two', uploader_id: 'same-user',
  }], { fetchImpl });

  assert.equal(first[0].video_play_count, 100);
  assert.equal(second[0].video_play_count, 200);
  assert.equal(calls.length, 2);
});

test('leaves metadata usable when Instagram rejects the fallback request', async () => {
  const infos = [{ id: 'reel', uploader_id: '1' }];
  const result = await enrichInstagramViewCounts(infos, {
    fetchImpl: async () => { throw new Error('rate limited'); },
  });

  assert.equal(result, infos);
});
