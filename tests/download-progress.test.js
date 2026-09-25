import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDownloadProgress,
  formatDownloadSpeed,
  formatRemainingTime,
  isDownloadDurationComplete,
  parseFfmpegOutTime,
  parseYtDlpProgress,
  YT_DLP_PROGRESS_ARGS
} from '../server/services/download-progress.js';

test('formats technical download speeds with familiar decimal units', () => {
  assert.equal(formatDownloadSpeed('17.03MiB/s'), '17,9 MB/s');
  assert.equal(formatDownloadSpeed('512KiB/s'), '524,3 KB/s');
  assert.equal(formatDownloadSpeed('1.5GiB/s'), '1,6 GB/s');
});

test('parses FFmpeg HLS timestamps used by Twitch download progress', () => {
  assert.equal(parseFfmpegOutTime('out_time=00:05:23.500000'), 323.5);
  assert.equal(parseFfmpegOutTime('out_time=12:34:56.000000'), 45296);
  assert.equal(parseFfmpegOutTime('out_time_ms=323500000'), null);
  assert.equal(parseFfmpegOutTime('out_time=00:61:00.000000'), null);
});

test('rejects truncated Twitch durations while allowing final-segment tolerance', () => {
  assert.equal(isDownloadDurationComplete(32330, 32330), true);
  assert.equal(isDownloadDurationComplete(32305, 32330), true);
  assert.equal(isDownloadDurationComplete(12780, 32330), false);
  assert.equal(isDownloadDurationComplete(null, 32330), false);
});

test('formats the ETA as readable Spanish time', () => {
  assert.equal(formatRemainingTime('01:42'), '1 min 42 s');
  assert.equal(formatRemainingTime('00:09'), '9 s');
  assert.equal(formatRemainingTime('1:02:03'), '1 h 2 min 3 s');
});

test('keeps progress detail concise and leaves percentage to its own indicator', () => {
  const detail = formatDownloadProgress('17.03MiB/s', '01:42');

  assert.equal(detail, 'Descargando archivo · Velocidad: 17,9 MB/s · 1 min 42 s restantes');
  assert.doesNotMatch(detail, /%|\/s\/s|ETA|MiB/);
});

test('uses and parses one stable progress message for every yt-dlp platform', () => {
  assert.ok(YT_DLP_PROGRESS_ARGS.includes('--progress-template'));
  assert.ok(YT_DLP_PROGRESS_ARGS.includes('--progress-delta'));
  assert.deepEqual(
    parseYtDlpProgress('downlink-progress:~42.6%| 5.2MiB/s|00:15'),
    {
      progress: '43%',
      detail: 'Descargando archivo · Velocidad: 5,5 MB/s · 15 s restantes',
      finalizing: false
    }
  );
  assert.deepEqual(
    parseYtDlpProgress('downlink-progress:NA|NA|Unknown'),
    { progress: null, detail: 'Descargando archivo', finalizing: false }
  );
  assert.deepEqual(
    parseYtDlpProgress('downlink-progress:100.0%|17.49MiB/s|NA'),
    { progress: '99%', detail: 'Finalizando archivo...', finalizing: true }
  );
});
