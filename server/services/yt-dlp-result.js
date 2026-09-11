import { parseVideoInfoCollection } from '../platforms/common/video-metadata.js';

export function getYtDlpInfoOutput({ code, stdout, stderr }, { allowPartialPlaylist = false } = {}) {
  if (code === 0) return stdout;

  // Image positions in Instagram posts can fail while the rest of the carousel
  // remains usable. A bare "null" is also printed on errors; it is not metadata.
  if (allowPartialPlaylist) {
    try {
      const info = JSON.parse(stdout);
      if (Array.isArray(info?.entries) && parseVideoInfoCollection(stdout).length > 0) {
        return stdout;
      }
    } catch { /* Preserve the extractor's original error below. */ }
  }

  throw new Error(stderr.trim() || `yt-dlp exited with code ${code}`);
}
