const BYTES_PER_UNIT = Object.freeze({
  B: 1,
  KB: 1_000,
  KIB: 1_024,
  MB: 1_000_000,
  MIB: 1_048_576,
  GB: 1_000_000_000,
  GIB: 1_073_741_824,
  TB: 1_000_000_000_000,
  TIB: 1_099_511_627_776
});

const PROGRESS_PREFIX = 'downlink-progress:';

export const YT_DLP_PROGRESS_ARGS = Object.freeze([
  '--newline',
  '--progress',
  '--progress-delta',
  '0.5',
  '--no-colors',
  '--progress-template',
  `download:${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s`
]);

// A live snapshot has a known number of fragments but no known byte size.
// yt-dlp's byte-based percentage and ETA for it are therefore misleading.
export const YT_DLP_LIVE_PROGRESS_ARGS = Object.freeze([
  '--newline', '--progress', '--progress-delta', '0.5', '--no-colors',
  '--progress-template',
  'download:downlink-live-progress:%(info.format_id)s|%(info.vcodec)s|%(progress.status)s|%(progress._speed_str)s|%(progress.fragment_index)s|%(progress.fragment_count)s',
]);

function formatDecimal(value) {
  return value
    .toFixed(1)
    .replace(/\.0$/, '')
    .replace('.', ',');
}

export function formatDownloadSpeed(rawSpeed) {
  const match = String(rawSpeed || '')
    .trim()
    .match(/^([\d.,]+)\s*([kmgt]?i?b)(?:\/s)?$/i);

  if (!match) return '';

  const value = Number(match[1].replace(',', '.'));
  const unit = match[2].toUpperCase();
  const multiplier = BYTES_PER_UNIT[unit];
  if (!Number.isFinite(value) || !multiplier) return '';

  const bytesPerSecond = value * multiplier;
  if (bytesPerSecond >= BYTES_PER_UNIT.GB) {
    return `${formatDecimal(bytesPerSecond / BYTES_PER_UNIT.GB)} GB/s`;
  }
  if (bytesPerSecond >= BYTES_PER_UNIT.MB) {
    return `${formatDecimal(bytesPerSecond / BYTES_PER_UNIT.MB)} MB/s`;
  }
  if (bytesPerSecond >= BYTES_PER_UNIT.KB) {
    return `${formatDecimal(bytesPerSecond / BYTES_PER_UNIT.KB)} KB/s`;
  }
  return `${formatDecimal(bytesPerSecond)} B/s`;
}

export function formatRemainingTime(rawEta) {
  const parts = String(rawEta || '').trim().split(':').map(Number);
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some(part => !Number.isInteger(part) || part < 0)
  ) {
    return '';
  }

  const [hours, minutes, seconds] = parts.length === 3
    ? parts
    : [0, parts[0], parts[1]];
  const result = [];

  if (hours) result.push(`${hours} h`);
  if (minutes) result.push(`${minutes} min`);
  if (seconds || result.length === 0) result.push(`${seconds} s`);
  return result.join(' ');
}

export function formatDownloadProgress(speed, eta) {
  const details = ['Descargando archivo'];
  const readableSpeed = formatDownloadSpeed(speed);
  const remainingTime = formatRemainingTime(eta);

  if (readableSpeed) details.push(`Velocidad: ${readableSpeed}`);
  if (remainingTime) details.push(`${remainingTime} restantes`);
  return details.join(' · ');
}

// An FFmpeg conversion is local processing, not a network download. Reuse
// only its estimated remaining time, without presenting its output-write rate
// as download speed. Keep the stage label when no estimate is available.
export function formatConversionProgress(label, progress) {
  const stage = String(label || '').trim();
  if (!stage || progress?.finalizing) return stage;
  const detail = String(progress?.detail || '');
  const estimate = detail.split(' · ').find(part =>
    /^\d+ (?:h|min|s)(?: \d+ (?:h|min|s))* restantes$/.test(part));
  if (!estimate) return stage;
  return `${stage.replace(/(?:\.\.\.|…)$/, '').trim()} · ${estimate} aprox.`;
}

export function parseYtDlpProgress(line) {
  const text = String(line || '');
  const marker = text.indexOf(PROGRESS_PREFIX);
  if (marker < 0) return null;

  const [rawPercent = '', rawSpeed = '', rawEta = ''] = text
    .slice(marker + PROGRESS_PREFIX.length)
    .trim()
    .split('|');
  const percentMatch = rawPercent.replace(',', '.').match(/[\d.]+/);
  const percent = Number.parseFloat(percentMatch?.[0] || '');
  const finalizing = Number.isFinite(percent) && percent >= 100;
  const displayedPercent = Number.isFinite(percent)
    ? Math.min(99, Math.max(0, Math.round(percent)))
    : null;

  return {
    progress: displayedPercent === null ? null : `${displayedPercent}%`,
    detail: finalizing
      ? 'Finalizando archivo...'
      : formatDownloadProgress(rawSpeed.trim(), rawEta.trim()),
    finalizing
  };
}

/** Show progress within the current track; yt-dlp downloads video and audio separately. */
export function createYouTubeLiveProgressParser({ now = () => performance.now() } = {}) {
  const marker = 'downlink-live-progress:';
  let lastTrack = null;
  let lastPercent = null;
  let samples = [];
  let lastCount = null;
  let highestFragment = 0;
  return line => {
    const text = String(line || '');
    const offset = text.indexOf(marker);
    if (offset < 0) return null;
    const [formatId = '', codec = '', status = '', speed = '', rawIndex = '', rawCount = ''] = text
      .slice(offset + marker.length).trim().split('|').map(value => value.trim());
    const isAudio = codec.toLowerCase() === 'none';
    const track = isAudio ? 'audio' : 'vídeo';
    const trackKey = `${formatId}|${track}`;
    if (trackKey !== lastTrack) {
      lastTrack = trackKey;
      lastPercent = null;
      samples = [];
      lastCount = null;
      highestFragment = 0;
    }
    const index = /^\d+$/.test(rawIndex) ? Number(rawIndex) : NaN;
    const count = /^\d+$/.test(rawCount) ? Number(rawCount) : NaN;
    if (Number.isSafeInteger(index) && Number.isSafeInteger(count) && count > 0 && index <= count) {
      // fragment_index can identify a fragment currently being downloaded.
      const completed = Math.min(99, Math.floor(Math.max(0, index - 1) / count * 100));
      lastPercent = Math.max(lastPercent ?? 0, completed);
      const timestamp = now();
      if (lastCount !== count) {
        samples = [];
        lastCount = count;
        highestFragment = 0;
      }
      const fragment = highestFragment = Math.max(highestFragment, index - 1, 0);
      const latest = samples.at(-1);
      if (!latest || timestamp < latest.time || timestamp - latest.time > 15_000) {
        samples = [{ time: timestamp, fragment }];
      } else if (fragment > latest.fragment) {
        samples.push({ time: timestamp, fragment });
      }
      while (samples.length > 2 && timestamp - samples[0].time > 30_000) samples.shift();
    } else if (status === 'finished') {
      lastPercent = 99;
    }
    if (samples.length && now() - samples.at(-1).time > 15_000) samples = [];
    const formattedSpeed = formatDownloadSpeed(speed);
    let remaining = '';
    if (status !== 'finished') {
      const first = samples[0];
      const latest = samples.at(-1);
      const elapsed = latest && first ? (latest.time - first.time) / 1000 : 0;
      const transferred = latest && first ? latest.fragment - first.fragment : 0;
      if (elapsed >= 3 && transferred >= 3 && lastCount > latest.fragment) {
        const seconds = Math.max(1, Math.ceil((lastCount - latest.fragment) * elapsed / transferred));
        if (Number.isSafeInteger(seconds)) {
          remaining = formatRemainingTime(`${Math.floor(seconds / 3600)}:${Math.floor(seconds / 60) % 60}:${seconds % 60}`);
        }
      }
    }
    const remainingDetail = status === 'finished' ? '' : remaining
      ? ` · Tiempo restante del ${track}: ${remaining} aprox.`
      : ` · Tiempo restante del ${track}: calculando...`;
    return {
      progress: lastPercent === null ? null : `${lastPercent}%`,
      detail: `Descargando ${track}${formattedSpeed ? ` · Velocidad: ${formattedSpeed}` : ''}${remainingDetail}`,
      // The first finished event only completes one track, not the whole job.
      finalizing: false,
    };
  };
}

export function parseFfmpegOutTime(line) {
  const match = String(line || '').trim().match(/^out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (
    !Number.isFinite(hours)
    || !Number.isFinite(minutes)
    || !Number.isFinite(seconds)
    || minutes >= 60
    || seconds >= 60
  ) {
    return null;
  }
  return (hours * 3600) + (minutes * 60) + seconds;
}

// FFmpeg sends a snapshot as several key=value lines, ending with progress=.
// Keep each process's samples together so time, size and speed agree.
export function createFfmpegProgressParser({ duration, now = () => performance.now() } = {}) {
  let snapshot = {};
  let previous = null;

  return line => {
    const match = String(line || '').trim().match(/^(total_size|out_time|speed|progress)=(.*)$/);
    if (!match) return null;
    const [, key, value] = match;
    snapshot[key] = value.trim();
    if (key !== 'progress') return null;

    const current = snapshot;
    snapshot = {};
    if (!['continue', 'end'].includes(current.progress)) return null;

    const seconds = parseFfmpegOutTime(`out_time=${current.out_time}`);
    const bytes = /^\d+$/.test(current.total_size || '') ? Number(current.total_size) : null;
    const rateMatch = (current.speed || '').match(/^(\d+(?:\.\d+)?)x$/);
    let rate = rateMatch ? Number(rateMatch[1]) : null;
    const timestamp = now();
    const elapsed = previous ? (timestamp - previous.timestamp) / 1000 : 0;
    const sameTransfer = previous && elapsed > 0
      && (seconds === null || previous.seconds === null || seconds >= previous.seconds)
      && (bytes === null || previous.bytes === null || bytes >= previous.bytes);

    if (rate === null && sameTransfer && seconds !== null && previous.seconds !== null) {
      rate = (seconds - previous.seconds) / elapsed;
    }
    const bytesPerSecond = sameTransfer && bytes !== null && previous.bytes !== null
      ? (bytes - previous.bytes) / elapsed
      : (bytes !== null && seconds > 0 && rate !== null ? (bytes / seconds) * rate : null);
    previous = { timestamp, seconds, bytes };

    const hasDuration = Number.isFinite(duration) && duration > 0;
    const percent = hasDuration && seconds !== null ? (seconds / duration) * 100 : null;
    const finalizing = current.progress === 'end' || (percent !== null && percent >= 100);
    const remaining = hasDuration && seconds !== null && rate > 0
      ? Math.ceil(Math.max(0, duration - seconds) / rate)
      : null;
    const eta = Number.isFinite(remaining)
      ? `${Math.floor(remaining / 3600)}:${Math.floor(remaining / 60) % 60}:${remaining % 60}`
      : '';
    const speed = Number.isFinite(bytesPerSecond) ? `${bytesPerSecond}B/s` : '';

    return {
      progress: finalizing ? '99%' : (percent === null ? null : `${Math.min(99, Math.max(0, Math.round(percent)))}%`),
      detail: finalizing ? 'Finalizando archivo...' : formatDownloadProgress(speed, eta),
      finalizing,
    };
  };
}

export function isDownloadDurationComplete(actualDuration, expectedDuration, toleranceSeconds = 30) {
  const actual = Number(actualDuration);
  const expected = Number(expectedDuration);
  const tolerance = Number(toleranceSeconds);
  if (!Number.isFinite(actual) || actual <= 0 || !Number.isFinite(expected) || expected <= 0) return false;
  return actual + Math.max(0, Number.isFinite(tolerance) ? tolerance : 0) >= expected;
}
