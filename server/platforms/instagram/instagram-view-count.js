import { getViewCount } from '@/server/platforms/common/video-metadata.js';

const INSTAGRAM_GRAPHQL_URL = 'https://www.instagram.com/graphql/query';
const INSTAGRAM_REELS_DOC_ID = '27234427476213202';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REELS_PAGES = 10;
const INSTAGRAM_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PAGES = 300;
const sessionCache = new WeakMap();
const pageCache = new WeakMap();
const INSTAGRAM_HEADERS = Object.freeze({
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.8',
  origin: 'https://www.instagram.com',
  referer: 'https://www.instagram.com/',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'x-ig-app-id': '936619743392459',
  'x-instagram-ajax': '1',
  'x-requested-with': 'XMLHttpRequest',
});

function getSetCookieHeaders(headers) {
  if (typeof headers?.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const combined = headers?.get?.('set-cookie');
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=[^;,]+)/) : [];
}

function createInstagramSession(response) {
  const cookies = getSetCookieHeaders(response.headers)
    .map(cookie => cookie.split(';', 1)[0].trim())
    .filter(Boolean);
  const csrfCookie = cookies.find(cookie => cookie.startsWith('csrftoken='));

  return {
    cookie: cookies.join('; '),
    csrfToken: csrfCookie?.slice('csrftoken='.length) || '',
  };
}

function getShortcode(info) {
  const url = info?.webpage_url || info?.original_url;
  const urlMatch = typeof url === 'string'
    ? url.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i)
    : null;
  return urlMatch?.[1] || (typeof info?.id === 'string' ? info.id : '');
}

function getUploaderId(info) {
  const value = info?.uploader_id ?? info?.channel_id ?? info?.owner?.id ?? info?.user?.pk;
  return value === null || value === undefined ? '' : String(value);
}

function toValidCount(value) {
  if (value === null || value === '' || value === undefined) return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function getCacheForFetch(fetchImpl) {
  let cache = pageCache.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    pageCache.set(fetchImpl, cache);
  }
  return cache;
}

function prunePageCache(cache) {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHED_PAGES) {
    cache.delete(cache.keys().next().value);
  }
}

async function getInstagramSession(fetchImpl, signal) {
  const cached = sessionCache.get(fetchImpl);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const bootstrap = await fetchImpl('https://www.instagram.com/', {
    headers: INSTAGRAM_HEADERS,
    signal,
  });
  if (!bootstrap.ok) return null;

  const session = createInstagramSession(bootstrap);
  if (!session.csrfToken) return null;
  sessionCache.set(fetchImpl, {
    value: session,
    expiresAt: Date.now() + INSTAGRAM_CACHE_TTL_MS,
  });
  return session;
}

async function fetchReelsPage(userId, maxId, session, fetchImpl, signal) {
  const cache = getCacheForFetch(fetchImpl);
  prunePageCache(cache);
  const cacheKey = `${userId}:${maxId}`;
  const cached = cache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const data = {
    include_feed_video: true,
    page_size: 12,
    target_user_id: userId,
  };
  if (maxId) data.max_id = maxId;

  const body = new URLSearchParams({
    variables: JSON.stringify({ data }),
    doc_id: INSTAGRAM_REELS_DOC_ID,
    server_timestamps: 'true',
  });
  const response = await fetchImpl(INSTAGRAM_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      ...INSTAGRAM_HEADERS,
      'content-type': 'application/x-www-form-urlencoded',
      cookie: session.cookie,
      'x-csrftoken': session.csrfToken,
    },
    body,
    signal,
  });
  if (!response.ok) return null;

  const payload = await response.json();
  const connection = payload?.data?.xdt_api__v1__clips__user__connection_v2 || null;
  if (connection) {
    cache.set(cacheKey, {
      value: connection,
      expiresAt: Date.now() + INSTAGRAM_CACHE_TTL_MS,
    });
  }
  return connection;
}

async function fetchReelsForUser(userId, targetShortcodes, session, fetchImpl, signal) {
  const matchingEdges = [];
  const pendingShortcodes = new Set(targetShortcodes);
  let maxId = '';

  for (let page = 0; page < MAX_REELS_PAGES && pendingShortcodes.size; page += 1) {
    const connection = await fetchReelsPage(userId, maxId, session, fetchImpl, signal);
    if (!connection) break;
    const edges = connection?.edges || [];

    edges.forEach(edge => {
      const shortcode = edge?.node?.media?.code;
      if (!pendingShortcodes.has(shortcode)) return;
      matchingEdges.push(edge);
      pendingShortcodes.delete(shortcode);
    });

    const nextMaxId = connection?.page_info?.end_cursor;
    if (!connection?.page_info?.has_next_page || !nextMaxId || nextMaxId === maxId) break;
    maxId = nextMaxId;
  }

  return matchingEdges;
}

/**
 * Instagram's post endpoint often omits view_count for public Reels. In that
 * case, recover play_count from the creator's public clips connection.
 */
export async function enrichInstagramViewCounts(
  infos,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!Array.isArray(infos) || typeof fetchImpl !== 'function') return infos;

  const missing = infos
    .map((info, index) => ({
      index,
      shortcode: getShortcode(info),
      userId: getUploaderId(info),
    }))
    .filter(item => getViewCount(infos[item.index]) === null && item.shortcode && item.userId);
  if (!missing.length) return infos;

  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const session = await getInstagramSession(fetchImpl, signal);
    if (!session) return infos;

    const targetsByUser = new Map();
    missing.forEach(({ userId, shortcode }) => {
      if (!targetsByUser.has(userId)) targetsByUser.set(userId, new Set());
      targetsByUser.get(userId).add(shortcode);
    });
    const edgeGroups = await Promise.all(
      [...targetsByUser].map(([userId, shortcodes]) => (
        fetchReelsForUser(userId, shortcodes, session, fetchImpl, signal)
      )),
    );
    const countsByShortcode = new Map();

    edgeGroups.flat().forEach(edge => {
      const media = edge?.node?.media;
      const shortcode = media?.code;
      const count = toValidCount(media?.play_count ?? media?.view_count);
      if (shortcode && count !== null) countsByShortcode.set(shortcode, count);
    });

    return infos.map(info => {
      if (getViewCount(info) !== null) return info;
      const count = countsByShortcode.get(getShortcode(info));
      return count === undefined ? info : { ...info, video_play_count: count };
    });
  } catch {
    // Views are optional metadata: extraction must still succeed if Instagram
    // throttles or changes this secondary endpoint.
    return infos;
  }
}
