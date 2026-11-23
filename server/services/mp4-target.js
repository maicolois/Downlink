/** Default to the compatible path unless a desktop explicitly asks for original. */
export function resolveMp4Target({ requestedTarget, userAgent = '', mobileHint = '' } = {}) {
  if (requestedTarget !== 'original') return 'compatible';
  // The client handles desktop-mode iPads using touch information unavailable
  // to HTTP. Also honor unambiguous mobile signals from request headers.
  if (/android|iphone|ipad|ipod|mobile|iemobile|windows phone/i.test(String(userAgent))
      || String(mobileHint).trim() === '?1') return 'compatible';
  return 'original';
}
