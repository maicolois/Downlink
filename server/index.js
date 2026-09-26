import express from 'express';
import { mountIosAssets } from '../ios/server.js';
import cors from 'cors';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createRequire } from 'module';
import { createInterface } from 'node:readline';
import { PlatformRegistry } from './platforms/common/platform-registry.js';
import { YouTubeProvider } from './platforms/youtube/youtube-provider.js';
import { XProvider } from './platforms/x/x-provider.js';
import { InstagramProvider } from './platforms/instagram/instagram-provider.js';
import { getInstagramStorySource, isValidInstagramStoryVideoId } from '../shared/instagram-stories.js';
import {
  parseInstagramStoryVideos, selectInstagramStory, storyUnavailableError, getInstagramStoryError,
} from './platforms/instagram/instagram-stories.js';
import { TikTokProvider } from './platforms/tiktok/tiktok-provider.js';
import { RedditProvider } from './platforms/reddit/reddit-provider.js';
import { TwitchProvider } from './platforms/twitch/twitch-provider.js';
import {
  parseVideoInfoCollection,
  getVideoDuration,
  getVideoFormats,
  getViewCount
} from './platforms/common/video-metadata.js';
import {
  createFfmpegProgressParser,
  formatDownloadProgress,
  isDownloadDurationComplete,
  parseYtDlpProgress,
  YT_DLP_PROGRESS_ARGS,
} from './services/download-progress.js';
import { getYtDlpInfoOutput } from './services/yt-dlp-result.js';
import { createInstagramAuth } from './auth/instagram-auth.js';
import { MP3_QUALITIES, getMp3BitrateFromQuality } from '../shared/mp3-qualities.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const bundledFfmpegPath = require('ffmpeg-static');
const bundledFfprobePath = require('ffprobe-static').path;

// yt-dlp se guarda junto a la aplicación para que Windows no dependa de PATH.
// Se puede sustituir con YT_DLP_PATH si ya existe una instalación administrada.
const BIN_DIR = path.join(PROJECT_ROOT, 'bin');
const ytDlpFileName = process.platform === 'win32'
  ? 'yt-dlp.exe'
  : process.platform === 'darwin'
    ? 'yt-dlp_macos'
    : 'yt-dlp';
const LOCAL_YT_DLP_PATH = path.join(BIN_DIR, ytDlpFileName);
const LOCAL_FFMPEG_PATH = path.join(BIN_DIR, path.basename(bundledFfmpegPath));
const LOCAL_FFPROBE_PATH = path.join(BIN_DIR, path.basename(bundledFfprobePath));
let ytDlpDownloadPromise = null;
const platformRegistry = new PlatformRegistry([
  new YouTubeProvider(),
  new XProvider(),
  // Account cookies belong to the connected browser, never to a shared provider.
  new InstagramProvider({ cookiesFile: '' }),
  new TikTokProvider(),
  new RedditProvider(),
  new TwitchProvider()
]);
const INFO_CACHE_TTL_MS = 10 * 60 * 1000;
const INFO_CACHE_MAX_ENTRIES = 100;
const infoCache = new Map();
const pendingInfoRequests = new Map();
const protectedProcesses = new Map();

function getFfmpegLocation() {
  if (fs.existsSync(LOCAL_FFMPEG_PATH) && fs.existsSync(LOCAL_FFPROBE_PATH)) {
    return BIN_DIR;
  }

  if (!bundledFfmpegPath || !bundledFfprobePath || !fs.existsSync(bundledFfmpegPath) || !fs.existsSync(bundledFfprobePath)) {
    throw new Error('No se encontraron las herramientas de conversión. Ejecuta npm install para instalarlas.');
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.copyFileSync(bundledFfmpegPath, LOCAL_FFMPEG_PATH);
  fs.copyFileSync(bundledFfprobePath, LOCAL_FFPROBE_PATH);
  console.log(`ffmpeg y ffprobe preparados en ${BIN_DIR}`);
  return BIN_DIR;
}

async function getYtDlpExecutable() {
  if (process.env.YT_DLP_PATH) {
    return process.env.YT_DLP_PATH;
  }

  if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
    return LOCAL_YT_DLP_PATH;
  }

  if (!ytDlpDownloadPromise) {
    ytDlpDownloadPromise = downloadYtDlp();
  }

  return ytDlpDownloadPromise;
}

async function probeMediaDuration(filePath) {
  getFfmpegLocation();
  return new Promise((resolve, reject) => {
    const proc = spawn(LOCAL_FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      void terminateConverter(proc);
      reject(new Error('FFprobe tardó demasiado en verificar la duración.'));
    }, 30_000);
    timeout.unref?.();

    proc.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    proc.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.once('close', code => {
      clearTimeout(timeout);
      const duration = Number.parseFloat(stdout.trim());
      if (code === 0 && Number.isFinite(duration)) resolve(duration);
      else reject(new Error(stderr.trim() || 'No se pudo verificar la duración del archivo.'));
    });
  });
}

async function warmYtDlp() {
  try {
    const executable = await getYtDlpExecutable();
    const proc = spawn(executable, ['--version'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    proc.on('error', () => {});
  } catch (err) {
    console.warn(`No se pudo preparar yt-dlp al iniciar: ${err.message}`);
  }
}

async function downloadYtDlp() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const temporaryPath = `${LOCAL_YT_DLP_PATH}.${process.pid}.download`;
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpFileName}`;

  try {
    console.log('yt-dlp no está instalado. Descargando una copia local...');
    const response = await fetch(downloadUrl);

    if (!response.ok || !response.body) {
      throw new Error(`la descarga devolvió HTTP ${response.status}`);
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryPath));
    fs.renameSync(temporaryPath, LOCAL_YT_DLP_PATH);

    if (process.platform !== 'win32') {
      fs.chmodSync(LOCAL_YT_DLP_PATH, 0o755);
    }

    console.log(`yt-dlp preparado en ${LOCAL_YT_DLP_PATH}`);
    return LOCAL_YT_DLP_PATH;
  } catch (err) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* ignore */ }
    ytDlpDownloadPromise = null;
    throw new Error(
      `No se pudo instalar yt-dlp automáticamente (${err.message}). ` +
      'Comprueba tu conexión o instala yt-dlp y define la variable YT_DLP_PATH.'
    );
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const instagramAuth = createInstagramAuth({ notifyRevoke: revokeInstagramConnection });

// Carpeta temporal para descargas
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

app.use(express.json());
app.use('/api', instagramAuth.middleware);
app.use('/api/instagram', instagramAuth.router);
app.use(cors());
mountIosAssets(app);
app.use(express.static(path.join(PROJECT_ROOT, 'public'), {
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.use('/shared', express.static(path.join(PROJECT_ROOT, 'shared')));

// ─── In-memory Job Store ────────────────────────────────────────────────────────
const jobs = new Map();

function assertInstagramConnection(context) {
  if (context && !instagramAuth.isCurrent(context)) {
    throw Object.assign(new Error('La sesión de Instagram ha caducado o se ha desconectado. Vuelve a conectar tu cuenta.'), {
      code: 'INSTAGRAM_SESSION_EXPIRED', status: 401,
    });
  }
}

function trackProtectedProcess(context, process) {
  if (!context) return;
  if (!protectedProcesses.has(context.key)) protectedProcesses.set(context.key, new Set());
  const processes = protectedProcesses.get(context.key);
  processes.add(process);
  const remove = () => {
    processes.delete(process);
    if (!processes.size) protectedProcesses.delete(context.key);
  };
  process.once('close', remove);
  process.once('error', remove);
  if (!instagramAuth.isCurrent(context)) void terminateConverter(process);
}

function terminateConverter(child) {
  if (!child) return Promise.resolve();
  if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve();
  if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    // Only PIDs returned by our own spawn calls are registered here. Kill ffmpeg
    // descendants too, so a cancelled conversion cannot recreate private files.
    return new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('close', () => resolve());
      killer.once('error', () => { child.kill(); resolve(); });
    });
  }
  try {
    if (Number.isInteger(child.pid) && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill();
  } catch { /* Process already finished. */ }
  return Promise.resolve();
}

function removeJobFiles(job, retries = 4) {
  let shouldRetry = false;
  for (const file of fs.readdirSync(DOWNLOADS_DIR)) {
    if (file.startsWith(`${job.id}.`)) {
      try { fs.unlinkSync(path.join(DOWNLOADS_DIR, file)); } catch { shouldRetry = true; }
    }
  }
  if (shouldRetry && retries > 0) {
    const retry = setTimeout(() => {
      try { removeJobFiles(job, retries - 1); } catch { /* Best-effort cleanup. */ }
    }, 250);
    retry.unref?.();
  }
}

function cancelledJobError() {
  return Object.assign(new Error('Descarga cancelada.'), { code: 'JOB_CANCELLED' });
}

function assertJobActive(job) {
  if (job?.cancelled) throw cancelledJobError();
}

async function revokeInstagramConnection(context) {
  const terminating = [...(protectedProcesses.get(context.key) || [])].map(terminateConverter);
  const revokedJobs = [];
  for (const [id, job] of jobs) {
    if (job.instagramContext?.key !== context.key) continue;
    job.revoked = true;
    revokedJobs.push(job);
    for (const stream of job.streams || []) stream.destroy();
    removeJobFiles(job);
    jobs.delete(id);
  }
  await Promise.allSettled(terminating);
  for (const job of revokedJobs) removeJobFiles(job);
}

function canReadJob(req, job) {
  if (!job.instagramContext) return true;
  const current = instagramAuth.getContext(req);
  return current?.key === job.instagramContext.key && instagramAuth.isCurrent(current);
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, '0');

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

// ─── Ejecutar yt-dlp como promesa (para info) ──────────────────────────────────
async function runYtDlp(args, options = {}) {
  assertJobActive(options.job);
  const executable = await getYtDlpExecutable();
  assertJobActive(options.job);

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      windowsHide: true,
      detached: Boolean(options.instagramContext || options.job) && process.platform !== 'win32',
    });
    trackProtectedProcess(options.instagramContext, proc);
    if (options.job) options.job.process = proc;
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (options.job?.process === proc) options.job.process = null;
      if (options.job?.cancelled) {
        reject(cancelledJobError());
        return;
      }
      try {
        resolve(getYtDlpInfoOutput({ code, stdout, stderr }, options));
      } catch (error) {
        reject(error);
      }
    });

    proc.on('error', (err) => {
      if (options.job?.process === proc) options.job.process = null;
      if (options.job?.cancelled) {
        reject(cancelledJobError());
        return;
      }
      reject(new Error(`No se pudo iniciar yt-dlp: ${err.message}`));
    });

    if (options.job?.cancelled) void terminateConverter(proc);
  });
}

function getInfoCacheKey(provider, url) {
  return `${provider.name}:${provider.normalizeUrl(url)}`;
}

function readCachedInfo(cacheKey) {
  const cached = infoCache.get(cacheKey);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    infoCache.delete(cacheKey);
    return null;
  }

  // Refresh insertion order so the size limit behaves like a small LRU cache.
  infoCache.delete(cacheKey);
  infoCache.set(cacheKey, cached);
  return cached.value;
}

function cacheInfo(cacheKey, value, ttl = INFO_CACHE_TTL_MS) {
  infoCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttl
  });

  while (infoCache.size > INFO_CACHE_MAX_ENTRIES) {
    infoCache.delete(infoCache.keys().next().value);
  }
}

async function getVideoInfo(provider, url, instagramContext = null, job = null) {
  assertJobActive(job);
  assertInstagramConnection(instagramContext);
  const normalizedUrl = provider.normalizeUrl(url);
  const storySource = provider.name === 'instagram' ? getInstagramStorySource(normalizedUrl) : null;
  const cacheKey = getInfoCacheKey(provider, normalizedUrl);
  const cached = instagramContext ? null : readCachedInfo(cacheKey);
  if (cached) return cached;

  const pending = instagramContext || job ? null : pendingInfoRequests.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const extract = extractionProvider => runYtDlp([
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      ...extractionProvider.getInfoYtDlpArgs({ url: normalizedUrl }),
      normalizedUrl
    ], { allowPartialPlaylist: provider.name === 'instagram' && !storySource, instagramContext, job });
    const raw = instagramContext
      ? await instagramAuth.withCookieFile(instagramContext, cookiesFile => extract(new InstagramProvider({ cookiesFile })))
      : await extract(provider);
    assertJobActive(job);
    assertInstagramConnection(instagramContext);
    const parsedVideos = storySource ? parseInstagramStoryVideos(raw) : parseVideoInfoCollection(raw);
    const extractedVideos = instagramContext ? parsedVideos : await provider.enrichVideoInfos(parsedVideos, { url: normalizedUrl });
    const videos = extractedVideos.map((info, index) => {
      const duration = getVideoDuration(info);
      const playlistItem = Number(info.playlist_index);
      return {
        id: info.id || null,
        playlistItem: Number.isInteger(playlistItem) && playlistItem > 0 ? playlistItem : index + 1,
        title: storySource?.username ? `Story de @${storySource.username}` : (info.title || 'Sin título'),
        thumbnail: info.thumbnail || '',
        duration,
        duration_string: duration !== null ? formatDuration(duration) : (info.duration_string || ''),
        channel: info.channel || info.uploader || 'Desconocido',
        view_count: getViewCount(info),
        videoFormats: getVideoFormats(info),
        ...(info.downlink_audio_url ? { audioSourceUrl: info.downlink_audio_url } : {})
      };
    });
    const firstVideo = videos[0];
    const value = {
      ...firstVideo,
      platform: provider.name,
      ...(storySource ? { contentType: 'instagram-story' } : {}),
      videos: videos.length > 1 ? videos : [],
      videoCount: videos.length,
      audioQualities: MP3_QUALITIES
    };

    // Active stories can expire or be added while a profile is open.
    // Authenticated metadata never enters the shared cache or request pool.
    assertJobActive(job);
    if (!instagramContext) cacheInfo(cacheKey, value, storySource ? 30_000 : INFO_CACHE_TTL_MS);
    return value;
  })();

  if (instagramContext || job) return request;
  pendingInfoRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (pendingInfoRequests.get(cacheKey) === request) {
      pendingInfoRequests.delete(cacheKey);
    }
  }
}

// ─── POST /api/info — Obtener metadata del video ───────────────────────────────
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;

    const provider = platformRegistry.findByUrl(url);
    if (!provider) {
      return res.status(400).json({ error: 'URL de YouTube, X, Instagram, TikTok, Reddit o Twitch no válida' });
    }

    const context = provider.name === 'instagram' ? instagramAuth.getContext(req) : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getVideoInfo(provider, url, context));
  } catch (err) {
    console.error('Error fetching info:', instagramAuth.getContext(req) ? (err.code || 'Instagram extraction failed') : err.message);
    if (err.code === 'INSTAGRAM_SESSION_EXPIRED') {
      return res.status(401).json({ code: err.code, error: err.message });
    }
    if (getInstagramStorySource(req.body?.url)) {
      const { status, ...body } = getInstagramStoryError(err);
      return res.status(status).json(body);
    }
    res.status(500).json({ error: 'No se pudo obtener el vídeo. Comprueba que el enlace sea público y esté disponible.' });
  }
});

// ─── POST /api/download — Iniciar descarga en background ───────────────────────
app.post('/api/download', async (req, res) => {
  const { url, format, quality, playlistItem, videoId } = req.body;

  const provider = platformRegistry.findByUrl(url);
  if (!provider) {
    return res.status(400).json({ error: 'URL de YouTube, X, Instagram, TikTok, Reddit o Twitch no válida' });
  }

  if (!format || !['mp3', 'mp4'].includes(format)) {
    return res.status(400).json({ error: 'Formato no válido. Usa mp3 o mp4.' });
  }

  const storySource = provider.name === 'instagram' ? getInstagramStorySource(url) : null;
  if (storySource && !isValidInstagramStoryVideoId(videoId)) {
    return res.status(400).json({ error: 'Selecciona una story válida antes de descargar.' });
  }

  const selectedQuality = String(quality ?? (format === 'mp3' ? '0' : 'best'));
  const validQuality = format === 'mp3'
    ? /^[0-9]$/.test(selectedQuality)
    : selectedQuality === 'best' || /^[1-9]\d{0,4}$/.test(selectedQuality);
  if (!validQuality) {
    return res.status(400).json({ error: 'Calidad no válida para el formato seleccionado.' });
  }

  const selectedPlaylistItem = playlistItem === null || playlistItem === undefined
    ? null
    : Number(playlistItem);
  if (selectedPlaylistItem !== null && (
    provider.name !== 'instagram'
    || !Number.isInteger(selectedPlaylistItem)
    || selectedPlaylistItem < 1
    || selectedPlaylistItem > 1000
  )) {
    return res.status(400).json({ error: 'Elemento del carrusel no válido.' });
  }

  const jobId = uuidv4();

  const job = {
    id: jobId,
    status: 'starting',
    progress: '0%',
    progressDetail: 'Analizando el vídeo...',
    format,
    quality: selectedQuality,
    playlistItem: selectedPlaylistItem,
    videoId: storySource ? videoId : null,
    isInstagramStory: Boolean(storySource),
    instagramContext: provider.name === 'instagram' ? instagramAuth.getContext(req) : null,
    url: provider.normalizeUrl(url),
    filename: null,
    filePath: null,
    error: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    process: null,
    cancelled: false,
    workerPromise: null
  };

  jobs.set(jobId, job);

  // Responder inmediatamente con el jobId
  res.json({ jobId });

  // Iniciar descarga en background
  job.workerPromise = startDownloadJob(job);
});

// ─── Background download worker ────────────────────────────────────────────────
async function startDownloadJob(job) {
  try {
    assertJobActive(job);
    if (job.instagramContext) {
      await instagramAuth.withCookieFile(job.instagramContext, cookiesFile => performDownloadJob(job, new InstagramProvider({ cookiesFile })));
    } else {
      await performDownloadJob(job, platformRegistry.findByUrl(job.url));
    }
  } catch (error) {
    failDownloadJob(job, error);
  }
}

function runJobProcess(job, executable, args, label) {
  assertJobActive(job);

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    trackProtectedProcess(job.instagramContext, proc);
    job.process = proc;
    let stderr = '';
    const parseFfmpegProgress = createFfmpegProgressParser({ duration: job.duration });

    for (const stream of [proc.stdout, proc.stderr]) {
      if (!stream) continue;
      createInterface({ input: stream, crlfDelay: Infinity })
        .on('line', line => parseProgress(job, line, parseFfmpegProgress));
    }
    proc.stderr?.on('data', data => {
      stderr += data.toString();
    });

    proc.once('close', code => {
      if (job.process === proc) job.process = null;
      if (job.cancelled) reject(cancelledJobError());
      else if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${label} exited with code ${code}`));
    });
    proc.once('error', err => {
      if (job.process === proc) job.process = null;
      if (job.cancelled) reject(cancelledJobError());
      else reject(new Error(`No se pudo iniciar ${label}: ${err.message}`));
    });

    if (job.cancelled) void terminateConverter(proc);
  });
}

async function performDownloadJob(job, provider) {
  let preparedDownload = null;
  try {
    assertJobActive(job);
    // 1. Obtener título
    console.log(`[Job ${job.id.slice(0, 8)}] Starting: format=${job.format}, quality=${job.quality}`);
    assertInstagramConnection(job.instagramContext);
    const info = await getVideoInfo(provider, job.url, job.instagramContext, job);
    assertJobActive(job);
    const selectedVideoIndex = Array.isArray(info.videos)
      ? info.videos.findIndex(video => video.playlistItem === job.playlistItem)
      : -1;
    const selectedVideo = job.isInstagramStory
      ? selectInstagramStory(info, job.videoId)
      : (selectedVideoIndex >= 0 ? info.videos[selectedVideoIndex] : info);
    job.duration = Number(selectedVideo.duration) || Number(info.duration) || null;
    const providerArgs = provider.getYtDlpArgs({
      url: job.url,
      format: job.format,
      quality: job.quality,
      video: selectedVideo,
      videoId: job.videoId,
      playlistItem: job.playlistItem ?? 1,
    });
    if (provider.name === 'twitch') job.progressDetail = 'Buscando audio original disponible de Twitch...';
    preparedDownload = await provider.prepareDownload({
      url: job.url,
      format: job.format,
      quality: job.quality,
      video: selectedVideo,
      tempDirectory: DOWNLOADS_DIR,
      jobId: job.id,
    });
    assertJobActive(job);
    const downloadUrl = preparedDownload.url;
    providerArgs.push(...(preparedDownload.ytDlpArgs || []));
    const carouselSuffix = job.isInstagramStory
      ? ` - ${job.videoId}`
      : (selectedVideoIndex >= 0 ? ` - Vídeo ${selectedVideoIndex + 1}` : '');
    const safeTitle = `${selectedVideo.title || 'video'}${carouselSuffix}`
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 100);

    job.filename = `${safeTitle}.${job.format}`;
    job.status = 'downloading';
    job.progressDetail = 'Preparando archivo...';

    // 2. Construir argumentos de yt-dlp
    const ffmpegLocation = getFfmpegLocation();
    const executable = await getYtDlpExecutable();
    assertJobActive(job);

    let ytArgs;
    let tempAudioPath = null;
    let finalFilePath = path.join(DOWNLOADS_DIR, `${job.id}.%(ext)s`);

    if (job.format === 'mp3') {
      const bitrate = getMp3BitrateFromQuality(job.quality);
      tempAudioPath = path.join(DOWNLOADS_DIR, `${job.id}.audio.%(ext)s`);
      ytArgs = [
        '-f', 'bestaudio/best',
        '--no-playlist',
        '--no-warnings',
        ...YT_DLP_PROGRESS_ARGS,
        '--ffmpeg-location', ffmpegLocation,
        '-o', tempAudioPath,
        ...providerArgs,
        downloadUrl
      ];

      finalFilePath = path.join(DOWNLOADS_DIR, `${job.id}.mp3`);

      console.log(`[Job ${job.id.slice(0, 8)}] Preparing MP3 (bitrate ${bitrate}k)`);

      await runJobProcess(job, executable, ytArgs, 'yt-dlp');
      assertJobActive(job);

      const tempFiles = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(`${job.id}.audio.`));
      const downloadedAudio = tempFiles.find(f => ['.m4a', '.webm', '.mp4', '.aac', '.opus', '.mp3', '.wav', '.flac', '.ogg'].includes(path.extname(f).toLowerCase()));

      if (!downloadedAudio) {
        if (job.isInstagramStory) throw storyUnavailableError();
        throw new Error('No se pudo obtener el audio base para convertir a MP3');
      }

      const audioInputPath = path.join(DOWNLOADS_DIR, downloadedAudio);
      const ffmpegExecutable = path.join(BIN_DIR, path.basename(bundledFfmpegPath));
      assertJobActive(job);

      console.log(`[Job ${job.id.slice(0, 8)}] Converting to MP3 with FFmpeg: ${ffmpegExecutable} -i ${audioInputPath} -c:a libmp3lame -b:a ${bitrate}k ${finalFilePath}`);

      job.status = 'converting';
      job.progress = '99%';
      job.progressDetail = 'Convirtiendo a MP3...';
      await runJobProcess(job, ffmpegExecutable, [
          '-hide_banner',
          '-loglevel', 'error',
          '-i', audioInputPath,
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', `${bitrate}k`,
          '-ar', '44100',
          '-ac', '2',
          finalFilePath
        ], 'ffmpeg');
      assertJobActive(job);

      try { fs.unlinkSync(audioInputPath); } catch (e) { /* ignore */ }
      job.filePath = finalFilePath;
      job.finalExtension = '.mp3';
      job.filename = `${safeTitle}.mp3`;
    } else {
      const heightFilter = job.quality === 'best' ? '' : `[height<=${job.quality}]`;
      ytArgs = [
        '-f', `bestvideo${heightFilter}+bestaudio/best${heightFilter}/bestvideo${heightFilter}/best`,
        '--merge-output-format', 'mp4',
        '--recode-video', 'mp4',
        '--no-playlist',
        '--no-warnings',
        ...YT_DLP_PROGRESS_ARGS,
        '--ffmpeg-location', ffmpegLocation,
        '-o', finalFilePath,
        ...providerArgs,
        downloadUrl
      ];

      console.log(`[Job ${job.id.slice(0, 8)}] Preparing MP4`);

      await runJobProcess(job, executable, ytArgs, 'yt-dlp');
      assertJobActive(job);

      job.filePath = path.join(DOWNLOADS_DIR, `${job.id}.mp4`);
      if (!fs.existsSync(job.filePath)) {
        if (job.isInstagramStory) throw storyUnavailableError();
        throw new Error('No se pudo generar el archivo MP4.');
      }
      job.finalExtension = '.mp4';
      job.filename = `${safeTitle}.mp4`;
    }
    
    assertJobActive(job);
    assertInstagramConnection(job.instagramContext);
    if (provider.name === 'twitch' && Number.isFinite(job.duration) && job.duration > 0) {
      job.status = 'converting';
      job.progress = '99%';
      job.progressDetail = 'Verificando que el VOD esté completo...';
      const actualDuration = await probeMediaDuration(job.filePath);
      assertJobActive(job);
      if (!isDownloadDurationComplete(actualDuration, job.duration)) {
        throw new Error(
          `La descarga de Twitch quedó incompleta (${Math.round(actualDuration)} de ${Math.round(job.duration)} segundos).`,
        );
      }
    }
    const stat = fs.statSync(job.filePath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

    job.status = 'ready';
    job.progress = '100%';
    job.progressDetail = `Listo — ${sizeMB} MB`;
    console.log(`[Job ${job.id.slice(0, 8)}] Completed: ${job.filename} (${sizeMB} MB)`);

  } catch (err) {
    failDownloadJob(job, err);
  } finally {
    try { await preparedDownload?.cleanup?.(); } catch { /* Temporary manifests are best-effort cleanup. */ }
  }
}

function failDownloadJob(job, err) {
  if (job.cancelled || err.code === 'JOB_CANCELLED') {
    job.cancelled = true;
    job.status = 'cancelled';
    job.error = null;
    job.progressDetail = 'Descarga cancelada';
    job.process = null;
    try { removeJobFiles(job); } catch { /* ignore */ }
    return;
  }

  console.error(`[Job ${job.id.slice(0, 8)}] Error:`, job.instagramContext ? (err.code || 'Instagram download failed') : err.message);
  job.status = 'error';
  job.error = err.code === 'INSTAGRAM_SESSION_EXPIRED' ? err.message : (job.isInstagramStory || job.instagramContext)
    ? getInstagramStoryError(err).error
    : (err.message || 'Error al descargar. Verifica que yt-dlp y ffmpeg estén instalados.');
  job.process = null;

  // Limpiar archivos parciales
  try { removeJobFiles(job); } catch { /* ignore */ }
}

// ─── Parsear progreso de yt-dlp ─────────────────────────────────────────────────
function parseProgress(job, line, parseFfmpegProgress) {
  if (!line || !line.trim()) return;
  if (job.cancelled) return;
  job.lastActivity = Date.now();

  const templatedProgress = parseYtDlpProgress(line);
  if (templatedProgress) {
    if (templatedProgress.progress) job.progress = templatedProgress.progress;
    job.progressDetail = templatedProgress.detail;
    job.status = templatedProgress.finalizing ? 'converting' : 'downloading';
    return;
  }

  const ffmpegProgress = parseFfmpegProgress(line);
  if (ffmpegProgress) {
    if (ffmpegProgress.progress) job.progress = ffmpegProgress.progress;
    job.progressDetail = ffmpegProgress.detail;
    job.status = ffmpegProgress.finalizing ? 'converting' : 'downloading';
    return;
  }

  // [download]  45.3% of ~120.5MiB at  5.2MiB/s ETA 00:15
  const dlMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\S+)\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/);
  if (dlMatch) {
    const percent = parseFloat(dlMatch[1]);
    const finalizing = percent >= 100;
    job.progress = `${Math.min(99, Math.max(0, Math.round(percent)))}%`;
    job.status = finalizing ? 'converting' : 'downloading';
    const speed = dlMatch[3];
    const eta = dlMatch[4];
    job.progressDetail = finalizing ? 'Finalizando archivo...' : formatDownloadProgress(speed, eta);
    return;
  }

  // Simpler progress pattern: [download]  45.3% of ~120.5MiB
  const simpleMatch = line.match(/\[download\]\s+([\d.]+)%/);
  if (simpleMatch) {
    const percent = parseFloat(simpleMatch[1]);
    const finalizing = percent >= 100;
    job.progress = `${Math.min(99, Math.max(0, Math.round(percent)))}%`;
    job.status = finalizing ? 'converting' : 'downloading';
    job.progressDetail = finalizing ? 'Finalizando archivo...' : 'Descargando archivo';
    return;
  }

  // [download] Destination: filename
  if (line.includes('[download] Destination:')) {
    job.status = 'downloading';
    job.progressDetail = 'Descargando archivo...';
    return;
  }

  // [Merger] Merging formats
  if (line.includes('[Merger]') || line.includes('Merging formats')) {
    job.status = 'converting';
    job.progress = '99%';
    job.progressDetail = 'Uniendo vídeo y audio...';
    return;
  }

  // yt-dlp reports download 100% before these final MP4 post-processors end.
  if (
    line.includes('[FixupM3u8]')
    || line.includes('[VideoConvertor]')
    || line.includes('[VideoRemuxer]')
  ) {
    job.status = 'converting';
    job.progress = '99%';
    job.progressDetail = 'Finalizando archivo...';
    return;
  }

  // [ExtractAudio] or [ffmpeg] Converting
  if (line.includes('[ExtractAudio]') || line.includes('Converting')) {
    job.status = 'converting';
    job.progress = '95%';
    job.progressDetail = 'Convirtiendo a ' + job.format.toUpperCase() + '...';
    return;
  }

  // Already downloaded
  if (line.includes('has already been downloaded')) {
    job.status = 'converting';
    job.progress = '99%';
    job.progressDetail = 'Comprobando archivo...';
    return;
  }
}

// ─── GET /api/status/:jobId — Consultar estado del job ──────────────────────────
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job || !canReadJob(req, job)) {
    return res.status(404).json({ error: 'Job no encontrado' });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: job.status,
    progress: job.progress,
    progressDetail: job.progressDetail,
    filename: job.filename,
    format: job.format,
    error: job.error
  });
});

app.post('/api/cancel/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job || !canReadJob(req, job)) {
    return res.status(404).json({ error: 'Job no encontrado' });
  }
  if (job.status === 'cancelled') {
    return res.json({ status: 'cancelled' });
  }
  if (job.status === 'error') {
    return res.status(409).json({ error: job.error || 'La descarga ya terminó con un error.' });
  }

  job.cancelled = true;
  job.status = 'cancelled';
  job.error = null;
  job.progressDetail = 'Cancelando y eliminando archivos parciales...';
  job.lastActivity = Date.now();
  for (const stream of job.streams || []) stream.destroy();

  await terminateConverter(job.process);
  if (job.workerPromise) {
    await Promise.race([
      job.workerPromise,
      new Promise(resolve => setTimeout(resolve, 4_000)),
    ]);
  }
  removeJobFiles(job);
  job.progressDetail = 'Descarga cancelada';
  return res.json({ status: 'cancelled' });
});

// ─── GET /api/file/:jobId — Descargar el archivo completado ─────────────────────
app.get('/api/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job || !canReadJob(req, job)) {
    return res.status(404).json({ error: 'Job no encontrado' });
  }

  if (job.status !== 'ready' || !job.filePath) {
    return res.status(400).json({ error: 'Archivo no está listo todavía' });
  }

  if (!fs.existsSync(job.filePath)) {
    job.status = 'error';
    job.error = 'Archivo no encontrado en disco';
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }

  try {
    const stat = fs.statSync(job.filePath);
    const ext = job.finalExtension || `.${job.format}`;
    
    let mimeType = 'application/octet-stream';
    if (ext === '.mp3') mimeType = 'audio/mpeg';
    else if (ext === '.mp4') mimeType = 'video/mp4';
    else if (ext === '.mkv') mimeType = 'video/x-matroska';
    else if (ext === '.webm') mimeType = 'video/webm';
    else if (ext === '.m4a') mimeType = 'audio/mp4';

    const safeFilename = encodeURIComponent(job.filename || `download${ext}`);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);

    const stream = fs.createReadStream(job.filePath);
    job.streams ||= new Set();
    job.streams.add(stream);
    stream.once('close', () => {
      job.streams.delete(stream);
      if (job.revoked || job.cancelled) {
        res.destroy();
        removeJobFiles(job);
      }
    });
    res.once('close', () => stream.destroy());
    stream.pipe(res);

    stream.on('end', () => {
      // Safari may preview the file before the user saves it. Keep it available
      // for another explicit save; the existing four-hour cleanup and session
      // revocation still remove it. Never delete a file merely for previewing it.
      job.lastActivity = Date.now();
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al enviar archivo' });
      }
    });

  } catch (err) {
    console.error('File serve error:', err);
    res.status(500).json({ error: 'Error al servir el archivo' });
  }
});

// ─── Limpieza periódica ─────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();

  // Limpiar jobs viejos (>4 horas)
  for (const [id, job] of jobs) {
    if (now - job.lastActivity > 240 * 60 * 1000) {
      job.cancelled = true;
      if (job.process) void terminateConverter(job.process);
      try { removeJobFiles(job); } catch { /* ignore */ }
      jobs.delete(id);
      console.log(`[Cleanup] Deleted old job: ${id.slice(0, 8)}`);
    }
  }

  // Limpiar archivos huérfanos en downloads/ (>4 horas)
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    for (const file of files) {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 240 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log(`[Cleanup] Deleted orphan file: ${file}`);
      }
    }
  } catch (e) { /* ignore */ }
}, 10 * 60 * 1000); // Cada 10 min

// ─── Iniciar servidor ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  // Prepare/download the extractor before the first user submits a link.
  void warmYtDlp();
  console.log('');
  console.log('  ▶️ ══════════════════════════════════════════ ▶️');
  console.log('  ║                                              ║');
  console.log('  ║              DOWNLINK v1.2                   ║');
  console.log('  ║ YouTube · X · Instagram · TikTok · Reddit · Twitch ║');
  console.log('  ║               MP3 / MP4                     ║');
  console.log('  ║                                              ║');
  console.log(`  ║   🚀  http://localhost:${PORT}                  ║`);
  console.log('  ║                                              ║');
  console.log('  ▶️ ══════════════════════════════════════════ ▶️');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const job of jobs.values()) {
      job.cancelled = true;
      if (job.process) void terminateConverter(job.process);
    }
    void instagramAuth.dispose().finally(() => process.exit(0));
  });
}
