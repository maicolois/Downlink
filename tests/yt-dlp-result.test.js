import test from 'node:test';
import assert from 'node:assert/strict';
import { getYtDlpInfoOutput } from '../server/services/yt-dlp-result.js';
import { getInstagramStoryError } from '../server/platforms/instagram/instagram-stories.js';

test('a failed extractor printing null preserves the real login error', () => {
  for (const allowPartialPlaylist of [false, true]) {
    assert.throws(() => getYtDlpInfoOutput({
      code: 1, stdout: 'null\n',
      stderr: 'ERROR: [instagram:story] You need to log in to access this content.\n',
    }, { allowPartialPlaylist }), error => {
      assert.equal(getInstagramStoryError(error).code, 'INSTAGRAM_LOGIN_REQUIRED');
      return true;
    });
  }
});

test('only an explicitly allowed usable carousel can survive a partial extraction failure', () => {
  const stdout = JSON.stringify({ entries: [null, { id: 'Video', ext: 'mp4' }] });
  const result = { code: 1, stdout, stderr: 'A photo could not be extracted' };
  assert.equal(getYtDlpInfoOutput(result, { allowPartialPlaylist: true }), stdout);
  assert.throws(() => getYtDlpInfoOutput(result), /photo could not be extracted/);
  for (const invalid of ['null', '', '{}', '[]', 'bad json', '{"entries":[null]}', '{"entries":[{"ext":"jpg"}]}']) {
    assert.throws(() => getYtDlpInfoOutput({ ...result, stdout: invalid }, { allowPartialPlaylist: true }), /photo could not be extracted/);
  }
});

test('successful metadata is returned unchanged, and an empty failure reports its exit code', () => {
  assert.equal(getYtDlpInfoOutput({ code: 0, stdout: '{"id":"Video"}', stderr: 'warning' }), '{"id":"Video"}');
  assert.throws(() => getYtDlpInfoOutput({ code: 1, stdout: '', stderr: '' }), /code 1/);
});
