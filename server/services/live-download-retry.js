import { setTimeout as delay } from 'node:timers/promises';

// Retrying won't repair these failures and may repeatedly ask for inaccessible
// data or overwrite useful diagnostics. Unknown failures get a bounded retry.
export function isTerminalLiveDownloadError(error) {
  const code = String(error?.code || '');
  if (/^(?:JOB_CANCELLED|ENOSPC|EACCES|EPERM|ENOENT|YOUTUBE_(?:PRIVATE|MEMBERS_ONLY|AUTH_REQUIRED|AGE_VERIFICATION_REQUIRED|FORMAT_UNAVAILABLE|GEO_RESTRICTED|REMOVED|ACCESS_DENIED|DISK_FULL|PROCESSING_FAILED))$/i.test(code)) return true;
  // Live fragments can briefly return 404 even when the stream itself is
  // available. Retry the same frozen snapshot before treating it as missing.
  if ([400, 401, 403].includes(Number(error?.status))) return true;
  const raw = String(error?.message || '');
  const errors = raw.split(/\r?\n/).filter(line => /\bERROR:/i.test(line));
  const message = errors.length ? errors.join('\n') : raw;
  return /\bHTTP(?:\s+Error)?[\s:]+(?:400|401|403)\b|\b(?:400\s+bad\s+request|401\s+unauthori[sz]ed|403\s+forbidden)\b|\b(?:ENOSPC|EACCES|EPERM)\b|no\s+space\s+left|not\s+enough\s+(?:disk\s+)?space|disk\s+(?:is\s+)?full|permission\s+denied|private\s+video|members?[-\s]?only|sign\s+in|login\s+required|requested\s+format\s+(?:is\s+)?not\s+available|no\s+video\s+formats\s+found|(?:ffmpeg|ffprobe)\s+exited|no\s+se\s+pudo\s+iniciar\s+ffmpeg|\bpostprocessing:|conversion\s+failed/i.test(message);
}

// Signed media URLs can expire mid-download; yt-dlp may suppress the HTTP 401
// and report only the unavailable fragment when warnings are disabled.
export function isRefreshableLiveFragmentError(error) {
  const message = String(error?.message || '');
  return Number(error?.status) === 401
    || /\bHTTP(?:\s+Error)?[\s:]+401\b/i.test(message)
    || /\bfragment\s+\d+\s+(?:is\s+)?(?:not\s+found|unavailable|missing)\b/i.test(message);
}

/** Retry an unchanged live-download operation, leaving its partial files intact. */
export async function runLiveDownloadWithRetry(task, {
  checkCancelled = () => {},
  onRetry = () => {},
  shouldRetry = error => !isTerminalLiveDownloadError(error),
  sleep = delay,
  maxRetries = 2,
  maxTotalRetries = maxRetries,
  getProgress = () => null,
} = {}) {
  if (typeof task !== 'function') throw new TypeError('task must be a function');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
    throw new RangeError('maxRetries must be between 0 and 2');
  }
  if (!Number.isInteger(maxTotalRetries) || maxTotalRetries < maxRetries || maxTotalRetries > 20) {
    throw new RangeError('maxTotalRetries must be between maxRetries and 20');
  }
  let previousProgress = getProgress();
  let withoutProgress = 0;
  let totalRetries = 0;
  for (;;) {
    checkCancelled();
    try {
      return await task();
    } catch (error) {
      checkCancelled();
      const progress = getProgress();
      if (Number.isFinite(progress) && Number.isFinite(previousProgress) && progress > previousProgress) {
        withoutProgress = 0;
      }
      if (Number.isFinite(progress) && (!Number.isFinite(previousProgress) || progress > previousProgress)) {
        previousProgress = progress;
      }
      if (withoutProgress >= maxRetries || totalRetries >= maxTotalRetries || !shouldRetry(error)) throw error;
      withoutProgress++;
      totalRetries++;
      const delayMs = 1000 * withoutProgress;
      await onRetry({ attempt: withoutProgress, maxRetries, delayMs, error });
      checkCancelled();
      await sleep(delayMs);
      checkCancelled();
    }
  }
}
