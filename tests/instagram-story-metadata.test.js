import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstagramStoryVideos, selectInstagramStory, getInstagramStoryError,
} from '@/server/platforms/instagram/instagram-stories.js';

test('story metadata preserves stable IDs even when playlist positions change', () => {
  const raw = JSON.stringify({ entries: [
    { id: 'Story_B', playlist_index: 1, ext: 'mp4' },
    { id: 'Story_C', playlist_index: 2, ext: 'mp4' },
  ] });
  const videos = parseInstagramStoryVideos(raw);
  assert.equal(selectInstagramStory({ videos }, 'Story_B').playlist_index, 1);
  assert.throws(() => selectInstagramStory({ videos }, 'Story_A'), { code: 'INSTAGRAM_STORY_UNAVAILABLE' });
  assert.equal(selectInstagramStory(videos[1], 'Story_C').id, 'Story_C');
});

test('empty, expired and photo-only story responses give an actionable message', () => {
  for (const raw of ['', 'null', '{"entries":[]}', '{"entries":[{"id":"Photo","ext":"jpg"}]}']) {
    assert.throws(() => parseInstagramStoryVideos(raw), error => {
      const result = getInstagramStoryError(error);
      assert.equal(result.status, 404);
      assert.match(result.error, /caducado o ser fotografías/);
      return true;
    });
  }
  assert.throws(() => parseInstagramStoryVideos('{"entries":[{"ext":"mp4"}]}'));
});

test('stories return useful errors without exposing extractor diagnostics or session data', () => {
  const auth = getInstagramStoryError(new Error('You need to log in; --cookies C:/private/session.txt'));
  assert.equal(auth.status, 401);
  assert.equal(auth.code, 'INSTAGRAM_LOGIN_REQUIRED');
  assert.doesNotMatch(auth.error, /private|session.txt|--cookies/);
  assert.equal(getInstagramStoryError(new Error('HTTP Error 429: log in')).status, 429);
  assert.equal(getInstagramStoryError(new Error('HTTP Error 404')).status, 410);
  assert.equal(getInstagramStoryError(new Error('Output file does not contain any stream')).code, 'INSTAGRAM_STORY_NO_AUDIO');
  assert.equal(getInstagramStoryError(Object.assign(new Error('secret'), { code: 'INSTAGRAM_COOKIES_INVALID' })).status, 503);
  assert.equal(getInstagramStoryError(new Error('unexpected details')).status, 502);
});

test('digits in story identifiers are not mistaken for HTTP errors', () => {
  for (const code of [401, 403, 404, 429]) {
    const error = new Error(`ERROR: [instagram:story] 398313271${code}8637834: TypeError: response is not iterable`);
    assert.equal(getInstagramStoryError(error).status, 502);
  }
  assert.equal(getInstagramStoryError(new Error('HTTP Error 401: Unauthorized')).status, 401);
  assert.equal(getInstagramStoryError(new Error('HTTP 403: Forbidden')).status, 401);
  assert.equal(getInstagramStoryError(new Error('status code: 429')).status, 429);
});
