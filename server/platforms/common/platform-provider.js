export class PlatformProvider {
  constructor({ name, patterns }) {
    if (!name || !Array.isArray(patterns) || patterns.length === 0) {
      throw new Error('Un proveedor necesita un nombre y al menos un patrón de URL.');
    }

    this.name = name;
    this.patterns = patterns;
  }

  supports(url) {
    if (typeof url !== 'string') return false;
    return this.patterns.some(pattern => pattern.test(url.trim()));
  }

  normalizeUrl(url) {
    const value = url.trim();
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  getYtDlpArgs() {
    return [];
  }

  getInfoYtDlpArgs() {
    return this.getYtDlpArgs();
  }

  getDownloadUrl({ url } = {}) {
    return url;
  }

  async prepareDownload(options = {}) {
    return { url: this.getDownloadUrl(options), ytDlpArgs: [], cleanup: null };
  }

  async enrichVideoInfos(infos) {
    return infos;
  }
}
