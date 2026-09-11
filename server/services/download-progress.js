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
  const details = ['Preparando archivo'];
  const readableSpeed = formatDownloadSpeed(speed);
  const remainingTime = formatRemainingTime(eta);

  if (readableSpeed) details.push(`Velocidad: ${readableSpeed}`);
  if (remainingTime) details.push(`${remainingTime} restantes`);
  return details.join(' · ');
}
