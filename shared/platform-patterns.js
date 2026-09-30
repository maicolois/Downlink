import { INSTAGRAM_STORY_URL_PATTERNS } from '@/shared/instagram-stories.js';

export const YOUTUBE_URL_PATTERNS = [
  /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
  /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
  /^(https?:\/\/)?youtu\.be\/[\w-]{11}/,
  /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]{11}/,
  /^(https?:\/\/)?m\.youtube\.com\/watch\?v=[\w-]{11}/,
];

export const X_URL_PATTERNS = [
  /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\/[^/\s]+\/status\/\d+/i,
];

export const INSTAGRAM_URL_PATTERNS = [
  /^(https?:\/\/)?(www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|tv|reels?)\/(?!audio(?:\/|$))[\w-]+\/?(?:[?#][^\s]*)?$/i,
  ...INSTAGRAM_STORY_URL_PATTERNS,
];

export const TIKTOK_URL_PATTERNS = [
  /^(https?:\/\/)?(www\.|m\.)?tiktok\.com\/@[\w.-]+\/video\/\d+\/?(?:[?#][^\s]*)?$/i,
  /^(https?:\/\/)?(www\.)?tiktok\.com\/(?:t\/[\w-]+|share\/video\/\d+|embed\/(?:v2\/)?\d+)\/?(?:[?#][^\s]*)?$/i,
  /^(https?:\/\/)?(?:vm|vt)\.tiktok\.com\/[\w-]+\/?(?:[?#][^\s]*)?$/i,
];

export const REDDIT_URL_PATTERNS = [
  /^(https?:\/\/)?(?:[\w-]+\.)?reddit(?:media)?\.com\/(?:(?:r|user)\/[^/\s]+\/)?comments\/[^/?#&\s]+(?:\/[^?#\s]*)?\/?(?:[?#][^\s]*)?$/i,
  /^(https?:\/\/)?(?:[\w-]+\.)?reddit\.com\/r\/[^/\s]+\/s\/[\w-]+\/?(?:[?#][^\s]*)?$/i,
  /^(https?:\/\/)?redd\.it\/[a-z0-9]+\/?(?:[?#][^\s]*)?$/i,
];

export const TWITCH_URL_PATTERNS = [
  /^(https?:\/\/)?(?:(?:www|go|m)\.)?twitch\.tv\/(?:videos\/\d+|[^/\s]+\/v(?:ideo)?\/\d+)\/?(?:[?#][^\s]*)?$/i,
  /^(https?:\/\/)?player\.twitch\.tv\/\?(?=[^#\s]*\bvideo=v?\d+)[^#\s]+$/i,
  /^(https?:\/\/)?(?:(?:www|go|m)\.)?twitch\.tv\/(?:[^/\s]+\/)?clip\/[^/?#&\s]+\/?(?:[?#][^\s]*)?$/i,
  /^(https?:\/\/)?clips\.twitch\.tv\/(?!embed(?:[/?#]|$))(?:[^/?#\s]+\/)*[^/?#&\s]+\/?(?:[?#][^\s]*)?$/i,
  /^(https?:\/\/)?clips\.twitch\.tv\/embed\?(?=[^#\s]*\bclip=[^&#\s]+)[^#\s]+$/i,
];

export const SUPPORTED_PLATFORM_PATTERNS = [
  ...YOUTUBE_URL_PATTERNS,
  ...X_URL_PATTERNS,
  ...INSTAGRAM_URL_PATTERNS,
  ...TIKTOK_URL_PATTERNS,
  ...REDDIT_URL_PATTERNS,
  ...TWITCH_URL_PATTERNS,
];
