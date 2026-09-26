// A resumable reference, not a copy of the media or the Instagram session.
export const DOWNLOAD_SESSION_KEY = 'downlink.download.v1';
const MAX_AGE = 4 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = value => typeof value === 'string' ? value.slice(0, 2048) : '';
const httpUrl = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

export function createDownloadSession(getStorage = () => globalThis.localStorage, now = Date.now) {
  function normalize(value) {
    if (!value || !UUID.test(value.jobId) || !['mp3', 'mp4'].includes(value.format)
        || !Number.isFinite(value.createdAt) || value.createdAt > now()
        || now() - value.createdAt >= MAX_AGE || !httpUrl(value.video?.url)) return null;
    const quality = String(value.quality ?? '');
    if (!(value.format === 'mp3' ? /^[0-9]$/ : /^(?:best|[1-9]\d{0,4})$/).test(quality)) return null;
    const video = value.video;
    return {
      jobId: value.jobId, format: value.format, quality, createdAt: value.createdAt,
      profileId: text(value.profileId),
      video: {
        url: httpUrl(video.url), title: text(video.title), channel: text(video.channel),
        platform: text(video.platform), thumbnail: httpUrl(video.thumbnail),
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        view_count: Number.isFinite(video.view_count) ? video.view_count : null,
      },
    };
  }

  function load() {
    try {
      const storage = getStorage();
      const value = normalize(JSON.parse(storage.getItem(DOWNLOAD_SESSION_KEY)));
      if (!value) { storage.removeItem(DOWNLOAD_SESSION_KEY); return null; }
      return value.profileId === (storage.getItem('downlink.activeProfileId.v1') || '') ? value : null;
    } catch { return null; }
  }

  return {
    load,
    save(value) {
      try {
        const storage = getStorage();
        const record = normalize({ ...value, createdAt: now(),
          profileId: storage.getItem('downlink.activeProfileId.v1') || '' });
        if (record) storage.setItem(DOWNLOAD_SESSION_KEY, JSON.stringify(record));
      } catch { /* Downloads still work when browser storage is unavailable. */ }
    },
    clear(jobId) {
      try {
        const storage = getStorage();
        const record = JSON.parse(storage.getItem(DOWNLOAD_SESSION_KEY));
        if (!jobId || record?.jobId === jobId) storage.removeItem(DOWNLOAD_SESSION_KEY);
      } catch { /* Private browsing or full storage must not break the app. */ }
    },
  };
}
