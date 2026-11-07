import { randomBytes, timingSafeEqual } from 'node:crypto';

const ACCESS_TTL_MS = 4 * 60 * 60 * 1000;

// A scoped bearer grants access only to the prepared file, never to the
// YouTube account, status, cancellation, or another job. It allows iOS to
// hand the download to Safari even when Safari has a different cookie store.
export function createDownloadAccess({ pairing, youtubeAuth, now = Date.now } = {}) {
  function active(job) {
    return Boolean(job?.youtubeDeviceId && job.youtubeContext && job.status === 'ready'
      && youtubeAuth.isCurrent(job.youtubeContext)
      && pairing.isDeviceActive(job.youtubeDeviceId, job.youtubeContext.key));
  }

  function issue(job) {
    if (!active(job)) return null;
    if (!job.fileAccess || job.fileAccess.expiresAt <= now()) {
      job.fileAccess = {
        token: randomBytes(32).toString('base64url'),
        expiresAt: Math.min(now() + ACCESS_TTL_MS, job.youtubeContext.expiresAt),
      };
    }
    return job.fileAccess;
  }

  function permits(req, job) {
    const supplied = req.query?.access;
    if (!active(job) || !pairing.secureRequest(req) || typeof supplied !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !job.fileAccess
        || job.fileAccess.expiresAt <= now()) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(job.fileAccess.token));
  }

  return { issue, permits };
}
