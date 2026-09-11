import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDownloadProgress,
  formatDownloadSpeed,
  formatRemainingTime
} from '../server/services/download-progress.js';

test('formats technical download speeds with familiar decimal units', () => {
  assert.equal(formatDownloadSpeed('17.03MiB/s'), '17,9 MB/s');
  assert.equal(formatDownloadSpeed('512KiB/s'), '524,3 KB/s');
  assert.equal(formatDownloadSpeed('1.5GiB/s'), '1,6 GB/s');
});

test('formats the ETA as readable Spanish time', () => {
  assert.equal(formatRemainingTime('01:42'), '1 min 42 s');
  assert.equal(formatRemainingTime('00:09'), '9 s');
  assert.equal(formatRemainingTime('1:02:03'), '1 h 2 min 3 s');
});

test('keeps progress detail concise and leaves percentage to its own indicator', () => {
  const detail = formatDownloadProgress('17.03MiB/s', '01:42');

  assert.equal(detail, 'Preparando archivo · Velocidad: 17,9 MB/s · 1 min 42 s restantes');
  assert.doesNotMatch(detail, /%|\/s\/s|ETA|MiB/);
});
