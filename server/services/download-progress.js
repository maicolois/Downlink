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

export function isDownloadDurationComplete(actualDuration, expectedDuration, toleranceSeconds = 30) {
  const actual = Number(actualDuration);
  const expected = Number(expectedDuration);
  const tolerance = Number(toleranceSeconds);
  if (!Number.isFinite(actual) || actual <= 0 || !Number.isFinite(expected) || expected <= 0) return false;
  return actual + Math.max(0, Number.isFinite(tolerance) ? tolerance : 0) >= expected;
}
