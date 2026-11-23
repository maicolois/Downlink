import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFfmpegProgressParser,
  createYouTubeLiveProgressParser,
  formatConversionProgress,
  formatDownloadProgress,
  formatDownloadSpeed,
  formatRemainingTime,
  isDownloadDurationComplete,
  parseFfmpegOutTime,
  parseYtDlpProgress,
  YT_DLP_PROGRESS_ARGS,
  YT_DLP_LIVE_PROGRESS_ARGS
} from '@/server/services/download-progress.js';

test('formats technical download speeds with familiar decimal units', () => {
  assert.equal(formatDownloadSpeed('17.03MiB/s'), '17,9 MB/s');
  assert.equal(formatDownloadSpeed('512KiB/s'), '524,3 KB/s');
  assert.equal(formatDownloadSpeed('1.5GiB/s'), '1,6 GB/s');
});

test('live snapshots show fragment progress for each track without a false ETA', () => {
  const parse = createYouTubeLiveProgressParser();
  assert.ok(YT_DLP_LIVE_PROGRESS_ARGS.some(arg => arg.includes('progress.fragment_count')));
  assert.equal(parse('unrelated line'), null);
  assert.deepEqual(parse('downlink-live-progress:160|avc1.4D400C|downloading|1.5MiB/s|51|100'), {
    progress: '50%', detail: 'Descargando vídeo · Velocidad: 1,6 MB/s · Tiempo restante del vídeo: calculando...', finalizing: false,
  });
  assert.equal(parse('downlink-live-progress:160|avc1.4D400C|downloading|NA|48|100').progress, '50%');
  assert.deepEqual(parse('downlink-live-progress:160|avc1.4D400C|finished|1MiB/s|NA|NA'), {
    progress: '99%', detail: 'Descargando vídeo · Velocidad: 1 MB/s', finalizing: false,
  });
  assert.deepEqual(parse('downlink-live-progress:140|none|downloading|NA|1|100'), {
    progress: '0%', detail: 'Descargando audio · Tiempo restante del audio: calculando...', finalizing: false,
  });
  assert.deepEqual(parse('downlink-live-progress:140|none|downloading|NA|101|100'), {
    progress: '0%', detail: 'Descargando audio · Tiempo restante del audio: calculando...', finalizing: false,
  });
  assert.deepEqual(parse('downlink-live-progress:140|none|downloading|NA|100|100'), {
    progress: '99%', detail: 'Descargando audio · Tiempo restante del audio: calculando...', finalizing: false,
  });
});

test('estimates remaining time per live track from fragment throughput and resets after stalls', () => {
  let time = 0;
  const parse = createYouTubeLiveProgressParser({ now: () => time });
  const line = (format, codec, index, count = 100) => `downlink-live-progress:${format}|${codec}|downloading|1MiB/s|${index}|${count}`;
  assert.match(parse(line(160, 'avc1', 1)).detail, /calculando/);
  time = 2_000;
  assert.match(parse(line(160, 'avc1', 5)).detail, /calculando/);
  time = 5_000;
  assert.match(parse(line(160, 'avc1', 11)).detail, /Tiempo restante del vídeo: 45 s aprox\.$/);
  time = 6_000;
  assert.match(parse(line(160, 'avc1', 8)).detail, /45 s aprox\.$/, 'out-of-order fragments do not reverse progress');
  time = 22_000;
  assert.match(parse(line(160, 'avc1', 11)).detail, /calculando/, 'a stalled transfer loses its stale estimate');
  time = 26_000;
  assert.match(parse(line(160, 'avc1', 15)).detail, /1 min 26 s aprox\.$/);
  time = 27_000;
  assert.match(parse(line(140, 'none', 1)).detail, /Tiempo restante del audio: calculando/, 'audio starts a fresh estimate');
  time = 31_000;
  assert.match(parse(line(140, 'none', 5)).detail, /Tiempo restante del audio: 1 min 36 s aprox\.$/);
});

test('parses FFmpeg HLS timestamps used by Twitch download progress', () => {
  assert.equal(parseFfmpegOutTime('out_time=00:05:23.500000'), 323.5);
  assert.equal(parseFfmpegOutTime('out_time=12:34:56.000000'), 45296);
  assert.equal(parseFfmpegOutTime('out_time_ms=323500000'), null);
  assert.equal(parseFfmpegOutTime('out_time=00:61:00.000000'), null);
});

function ffmpegSnapshot(parse, { seconds = '00:00:10.000000', size = '2000000', speed = '2x', progress = 'continue' } = {}) {
  for (const line of [`total_size=${size}`, `out_time=${seconds}`, `speed= ${speed}`]) {
    assert.equal(parse(line), null);
  }
  return parse(`progress=${progress}`);
}

test('shows Twitch percentage, transfer speed and ETA using the same labels as YouTube', () => {
  let now = 0;
  const parse = createFfmpegProgressParser({ duration: 60, now: () => now });
  assert.deepEqual(ffmpegSnapshot(parse), {
    progress: '17%',
    detail: 'Descargando archivo · Velocidad: 400 KB/s · 25 s restantes',
    finalizing: false,
  });

  now = 2000;
  assert.deepEqual(ffmpegSnapshot(parse, { seconds: '00:00:20.000000', size: '4000000', speed: '5x' }), {
    progress: '33%',
    detail: 'Descargando archivo · Velocidad: 1 MB/s · 8 s restantes',
    finalizing: false,
  });
});

test('handles missing FFmpeg metrics, stalls and new transfers without stale or negative estimates', () => {
  let now = 0;
  const parse = createFfmpegProgressParser({ duration: 60, now: () => now });
  assert.equal(parse('unrelated diagnostic'), null);
  assert.deepEqual(ffmpegSnapshot(parse, { seconds: 'N/A', size: 'N/A', speed: 'N/A' }), {
    progress: null, detail: 'Descargando archivo', finalizing: false,
  });
  now = 1000;
  ffmpegSnapshot(parse);
  now = 2000;
  assert.equal(ffmpegSnapshot(parse, { speed: '0x' }).detail, 'Descargando archivo · Velocidad: 0 B/s');
  now = 3000;
  assert.equal(ffmpegSnapshot(parse, { seconds: '00:00:12.000000', size: '3000000', speed: 'N/A' }).detail,
    'Descargando archivo · Velocidad: 1 MB/s · 24 s restantes');
  now = 4000;
  assert.equal(ffmpegSnapshot(parse).detail, 'Descargando archivo · Velocidad: 400 KB/s · 25 s restantes');
  now = 5000;
  assert.deepEqual(parse('progress=continue'), {
    progress: null, detail: 'Descargando archivo', finalizing: false,
  });
});

test('reports speed without a known duration and keeps completion below 100 until the file is ready', () => {
  const unknown = createFfmpegProgressParser();
  assert.deepEqual(ffmpegSnapshot(unknown), {
    progress: null, detail: 'Descargando archivo · Velocidad: 400 KB/s', finalizing: false,
  });
  assert.deepEqual(ffmpegSnapshot(unknown, { progress: 'end' }), {
    progress: '99%', detail: 'Finalizando archivo...', finalizing: true,
  });
  assert.deepEqual(ffmpegSnapshot(createFfmpegProgressParser({ duration: 10 })), {
    progress: '99%', detail: 'Finalizando archivo...', finalizing: true,
  });
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

test('describes conversion with its own label and an approximate ETA', () => {
  const parse = createFfmpegProgressParser({ duration: 60 });
  const progress = ffmpegSnapshot(parse);
  assert.equal(formatConversionProgress('Preparando MP4 compatible...', progress),
    'Preparando MP4 compatible · 25 s restantes aprox.');
  assert.equal(formatConversionProgress('Optimizando MP4...', {
    detail: 'Descargando archivo · Velocidad: 30 MB/s · 1 h 2 min 3 s restantes', finalizing: false,
  }), 'Optimizando MP4 · 1 h 2 min 3 s restantes aprox.');
  assert.equal(formatConversionProgress('Preparando MP4 compatible...', { detail: 'Descargando archivo' }),
    'Preparando MP4 compatible...');
  assert.equal(formatConversionProgress('Preparando MP4 compatible...', {
    detail: 'Descargando archivo · 0 s restantes', finalizing: true,
  }), 'Preparando MP4 compatible...');
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
