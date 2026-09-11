import { SUPPORTED_PLATFORM_PATTERNS, INSTAGRAM_URL_PATTERNS } from '/shared/platform-patterns.js';
import { getVideoResolutionDescription } from '/shared/video-resolutions.js';
import { getInitialCarouselVideoIndex } from '/shared/carousel-selection.js';
import { getInstagramStorySource } from '/shared/instagram-stories.js';
import { initializeHomepage } from './homepage.js';
import { initializeInputPlaceholder } from './input-placeholder.js';
import { initializeInstagramAccount } from './instagram-account.js';
import { initializeProfileSystem } from './profile-system.js';

/* ═══════════════════════════════════════════════════════════
   DOWNLINK — Frontend Logic v1.1
   Job-based download with real progress tracking
   ═══════════════════════════════════════════════════════════ */

// ─── DOM Elements ───────────────────────────────────────────
const urlInput = document.getElementById('urlInput');
const urlClearButton = document.getElementById('urlClearButton');
const urlPasteButton = document.getElementById('urlPasteButton');
const inputHint = document.getElementById('inputHint');
const defaultInputHint = inputHint.textContent;
const homeReset = document.getElementById('homeReset');
const dynamicBg = document.getElementById('dynamicBg');
const analyzeStatus = document.getElementById('analyzeStatus');
const analyzeStatusText = document.getElementById('analyzeStatusText');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const resultsPanel = document.getElementById('resultsPanel');
const videoCard = document.getElementById('videoCard');
const storyNote = document.getElementById('storyNote');
const videoThumbnail = document.getElementById('videoThumbnail');
const videoDuration = document.getElementById('videoDuration');
const videoTitle = document.getElementById('videoTitle');
const videoChannel = document.getElementById('videoChannel');
const videoViews = document.getElementById('videoViews');
const carouselControls = document.getElementById('carouselControls');
const carouselPrevious = document.getElementById('carouselPrevious');
const carouselNext = document.getElementById('carouselNext');
const carouselPosition = document.getElementById('carouselPosition');
const formatToggle = document.getElementById('formatToggle');
const qualityGrid = document.getElementById('qualityGrid');
const downloadBtn = document.getElementById('downloadBtn');
const downloadProgress = document.getElementById('downloadProgress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');
const downloadComplete = document.getElementById('downloadComplete');
const completeText = document.getElementById('completeText');

// ─── State ──────────────────────────────────────────────────
let currentVideoInfo = null;
let currentCarouselIndex = 0;
let currentFormat = 'mp4';
let currentQuality = null;
let isDownloading = false;
let isPasting = false;
let inputRevision = 0;
let pollInterval = null;
let analyzeTimeout = null;
let backgroundThumbnail = null;
let qualityGridHeightAnimation = null;
let resultsExitAnimation = null;
let thumbnailTransitionToken = 0;
let thumbnailTransitionAnimations = [];
const inputPlaceholder = initializeInputPlaceholder(urlInput);
const instagramAccount = initializeInstagramAccount({ onChange: handleInstagramConnectionChange });

function handleInstagramConnectionChange({ connected, reason }) {
  if (currentVideoInfo?.platform === 'instagram') {
    clearThumbnailTransition();
    currentVideoInfo = null;
    currentCarouselIndex = 0;
    currentQuality = null;
    backgroundThumbnail = null;
    resultsPanel.classList.remove('visible');
    downloadComplete.classList.remove('visible');
    downloadProgress.classList.remove('visible');
    videoThumbnail.removeAttribute('src');
    videoTitle.textContent = '';
    videoChannel.textContent = '';
    videoViews.textContent = '';
    qualityGrid.innerHTML = '';
    syncBackgroundState();
    updateDownloadBtn();
  }
  const value = urlInput.value.trim();
  if (connected && reason === 'connected' && !urlInput.disabled && !isDownloading
      && INSTAGRAM_URL_PATTERNS.some(pattern => pattern.test(value))) {
    void analyzeVideo();
  }
}

function syncClearButtonState() {
  inputPlaceholder.sync();
  const hasText = urlInput.value.length > 0;
  urlClearButton.classList.toggle('visible', hasText);
  urlClearButton.disabled = !hasText || urlInput.disabled || isDownloading;
  urlClearButton.setAttribute('aria-hidden', String(!hasText));
  urlPasteButton.disabled = urlInput.disabled || isDownloading || isPasting;
  instagramAccount.setBusy(urlInput.disabled || isDownloading || isPasting);
}

async function pasteLink() {
  if (urlInput.disabled || isDownloading || isPasting) return;
  const previousValue = urlInput.value;
  const previousRevision = inputRevision;
  isPasting = true;
  syncClearButtonState();

  try {
    const text = await navigator.clipboard.readText();
    // A clipboard permission prompt can stay open while the field changes.
    if (inputRevision !== previousRevision || urlInput.value !== previousValue || urlInput.disabled || isDownloading) return;
    urlInput.focus();
    if (!text.trim()) {
      inputHint.textContent = 'Copia un enlace y vuelve a pegarlo.';
      inputHint.classList.add('is-notice');
      return;
    }
    urlInput.value = text.trim();
    urlInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  } catch {
    if (inputRevision !== previousRevision || urlInput.value !== previousValue || urlInput.disabled || isDownloading) return;
    urlInput.focus();
    inputHint.textContent = 'Puedes pegar el enlace directamente en el campo.';
    inputHint.classList.add('is-notice');
  } finally {
    isPasting = false;
    syncClearButtonState();
  }
}

function syncBackgroundState(completedVideo = null) {
  const value = urlInput.value.trim();
  if (!value) {
    backgroundThumbnail = null;
  } else if (completedVideo?.url === value) {
    backgroundThumbnail = completedVideo.thumbnail || null;
  }
  const hasVideo = Boolean(backgroundThumbnail);

  document.body.classList.toggle('has-video', hasVideo);
  if (dynamicBg) {
    if (hasVideo) {
      dynamicBg.style.backgroundImage = `url(${JSON.stringify(backgroundThumbnail)})`;
    } else {
      dynamicBg.style.removeProperty('background-image');
    }
    dynamicBg.classList.toggle('active', hasVideo);
  }
}

function resetInterface() {
  inputRevision += 1;
  clearTimeout(analyzeTimeout);
  analyzeTimeout = null;
  clearThumbnailTransition();

  if (resultsExitAnimation) {
    resultsExitAnimation.cancel();
    resultsExitAnimation = null;
  }

  if (qualityGridHeightAnimation) {
    qualityGridHeightAnimation.cancel();
    qualityGridHeightAnimation = null;
  }

  currentVideoInfo = null;
  currentCarouselIndex = 0;
  currentQuality = null;
  backgroundThumbnail = null;

  urlInput.value = '';
  syncBackgroundState();
  syncClearButtonState();

  const finishReset = () => {
    resultsPanel.classList.remove('visible');
    resultsPanel.style.removeProperty('overflow');
    resultsPanel.style.removeProperty('pointer-events');
    downloadProgress.classList.remove('visible');
    downloadComplete.classList.remove('visible');

    videoThumbnail.removeAttribute('src');
    videoThumbnail.alt = 'Miniatura del vídeo';
    videoDuration.textContent = '0:00';
    videoTitle.textContent = '';
    videoChannel.textContent = '';
    videoViews.textContent = '';
    videoViews.closest('.video-card__meta-item').hidden = false;
    videoCard.classList.remove('is-story');
    storyNote.hidden = true;
    inputHint.textContent = defaultInputHint;
    inputHint.classList.remove('is-notice');
    carouselControls.classList.remove('visible');
    carouselControls.setAttribute('aria-hidden', 'true');
    carouselPosition.textContent = '';

    qualityGrid.innerHTML = '';
    qualityGrid.onmousemove = null;
    qualityGrid.onmouseleave = null;
    qualityGrid.style.removeProperty('overflow');

    currentFormat = 'mp4';
    formatToggle.classList.add('mp4-active');
    formatToggle.querySelectorAll('.format-toggle__btn').forEach(button => {
      button.classList.toggle('active', button.dataset.format === 'mp4');
    });

    progressBar.classList.remove('converting');
    progressBar.style.width = '0%';
    progressBar.style.marginLeft = '0';
    progressText.textContent = 'Preparando archivo...';
    progressPercent.textContent = '0%';
    completeText.textContent = '¡Descarga completada!';

    updateDownloadBtn();
    urlInput.disabled = false;
    syncClearButtonState();
    urlInput.focus();
  };

  const shouldAnimateResults = resultsPanel.classList.contains('visible');

  if (!shouldAnimateResults) {
    finishReset();
    return;
  }

  urlInput.disabled = true;
  syncClearButtonState();
  resultsPanel.style.pointerEvents = 'none';

  const animation = resultsPanel.getAnimations()
    .find(candidate => candidate.animationName === 'fadeInUp');

  if (!animation) {
    finishReset();
    return;
  }

  resultsExitAnimation = animation;

  animation.addEventListener('finish', () => {
    if (resultsExitAnimation !== animation) return;
    resultsExitAnimation = null;
    finishReset();
    animation.cancel();
  }, { once: true });

  animation.reverse();
  animation.updatePlaybackRate(-1.6);
}

// ─── URL Validation ─────────────────────────────────────────
function isValidDownloadURL(url) {
  return SUPPORTED_PLATFORM_PATTERNS.some(pattern => pattern.test(url.trim()));
}

// ─── Format Numbers ─────────────────────────────────────────
function formatViews(num) {
  if (num === null || num === '' || num === undefined) return 'Visitas no disponibles';
  const views = Number(num);
  if (!Number.isFinite(views) || views < 0) return 'Visitas no disponibles';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M vistas`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K vistas`;
  return `${views} vistas`;
}

function formatDurationWithUnits(seconds, fallback = '') {
  let value = seconds === null || seconds === '' || seconds === undefined
    ? Number.NaN
    : Number(seconds);

  if ((!Number.isFinite(value) || value < 0) && typeof fallback === 'string') {
    const parts = fallback.trim().split(':');
    if (parts.length >= 2 && parts.every(part => /^\d+(?:\.\d+)?$/.test(part))) {
      value = parts.reduce((total, part) => (total * 60) + Number(part), 0);
    }
  }

  if (!Number.isFinite(value) || value < 0) return 'Tiempo no disponible';

  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const parts = [];

  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (remainingSeconds || parts.length === 0) parts.push(`${remainingSeconds} s`);
  return parts.join(' ');
}

function getCarouselVideos() {
  if (!currentVideoInfo) return [];
  return Array.isArray(currentVideoInfo.videos) && currentVideoInfo.videos.length
    ? currentVideoInfo.videos
    : [currentVideoInfo];
}

function getSelectedVideoInfo() {
  const videos = getCarouselVideos();
  return videos[currentCarouselIndex] || videos[0] || null;
}

function isInstagramStory() {
  return currentVideoInfo?.contentType === 'instagram-story';
}

function clearThumbnailTransition(invalidate = true) {
  if (invalidate) thumbnailTransitionToken += 1;
  thumbnailTransitionAnimations.forEach(animation => animation.cancel());
  thumbnailTransitionAnimations = [];
  document.querySelectorAll('.video-card__thumbnail--leaving').forEach(thumbnail => thumbnail.remove());
}

function updateVideoThumbnail(video, animate, direction) {
  const nextSource = video.thumbnail || '';
  const nextAlt = video.title || 'Miniatura del vídeo';
  const currentSource = videoThumbnail.getAttribute('src') || '';

  if (!animate || !nextSource || !currentSource) {
    clearThumbnailTransition();
    videoThumbnail.src = nextSource;
    videoThumbnail.alt = nextAlt;
    return;
  }

  const transitionToken = ++thumbnailTransitionToken;
  const preloadedThumbnail = new Image();
  preloadedThumbnail.decoding = 'async';
  preloadedThumbnail.src = nextSource;

  const showPreloadedThumbnail = () => {
    if (transitionToken !== thumbnailTransitionToken) return;

    clearThumbnailTransition(false);

    const previousThumbnail = videoThumbnail.cloneNode(false);
    previousThumbnail.removeAttribute('id');
    previousThumbnail.classList.add('video-card__thumbnail--leaving');
    previousThumbnail.alt = '';
    previousThumbnail.setAttribute('aria-hidden', 'true');
    videoThumbnail.insertAdjacentElement('afterend', previousThumbnail);

    videoThumbnail.src = nextSource;
    videoThumbnail.alt = nextAlt;

    // Desplazamiento corto: la actual sale al lado contrario de la flecha
    // y la siguiente entra desde el lado hacia el que se navega.
    const thumbnailWidth = videoThumbnail.getBoundingClientRect().width;
    const travel = Math.min(Math.max(thumbnailWidth * 0.1, 28), 52);
    const offset = direction * travel;
    const timing = {
      duration: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both'
    };
    const incomingAnimation = videoThumbnail.animate(
      [
        {
          opacity: 0,
          transform: `translateX(${offset}px) scale(1.008)`,
          filter: 'blur(3px)',
          offset: 0
        },
        {
          opacity: 0.68,
          transform: `translateX(${offset * 0.32}px) scale(1.003)`,
          filter: 'blur(1.8px)',
          offset: 0.52
        },
        {
          opacity: 1,
          transform: 'translateX(0) scale(1)',
          filter: 'blur(0)',
          offset: 1
        }
      ],
      timing
    );
    const outgoingAnimation = previousThumbnail.animate(
      [
        {
          opacity: 1,
          transform: 'translateX(0) scale(1)',
          filter: 'blur(0)',
          offset: 0
        },
        {
          opacity: 0.42,
          transform: `translateX(${-offset * 0.68}px) scale(1.004)`,
          filter: 'blur(2.4px)',
          offset: 0.52
        },
        {
          opacity: 0,
          transform: `translateX(${-offset}px) scale(1.008)`,
          filter: 'blur(3px)',
          offset: 1
        }
      ],
      timing
    );

    thumbnailTransitionAnimations = [incomingAnimation, outgoingAnimation];
    Promise.allSettled([
      incomingAnimation.finished,
      outgoingAnimation.finished
    ]).then(() => {
      if (transitionToken !== thumbnailTransitionToken) return;
      incomingAnimation.cancel();
      previousThumbnail.remove();
      thumbnailTransitionAnimations = [];
    });
  };

  if (typeof preloadedThumbnail.decode === 'function') {
    preloadedThumbnail.decode().then(showPreloadedThumbnail, showPreloadedThumbnail);
  } else if (preloadedThumbnail.complete) {
    showPreloadedThumbnail();
  } else {
    preloadedThumbnail.addEventListener('load', showPreloadedThumbnail, { once: true });
    preloadedThumbnail.addEventListener('error', showPreloadedThumbnail, { once: true });
  }
}

function renderSelectedVideo(animate = false, direction = 1) {
  const videos = getCarouselVideos();
  if (!videos.length) return;

  currentCarouselIndex = Math.min(Math.max(currentCarouselIndex, 0), videos.length - 1);
  const video = videos[currentCarouselIndex];
  const isStory = isInstagramStory();
  const storySource = isStory ? getInstagramStorySource(currentVideoInfo.url) : null;

  videoCard.classList.toggle('is-story', isStory);
  updateVideoThumbnail(video, animate, direction);
  videoDuration.textContent = formatDurationWithUnits(video.duration, video.duration_string);
  videoTitle.textContent = isStory && storySource?.username && storySource.kind !== 'highlight'
    ? `Story de @${storySource.username}`
    : video.title || (isStory ? 'Story de Instagram' : 'Sin título');
  videoChannel.textContent = video.channel || 'Desconocido';
  videoViews.textContent = formatViews(video.view_count);
  const hasViewCount = video.view_count !== null && video.view_count !== ''
    && video.view_count !== undefined && Number.isFinite(Number(video.view_count))
    && Number(video.view_count) >= 0;
  videoViews.closest('.video-card__meta-item').hidden = isStory && !hasViewCount;

  const hasCarousel = videos.length > 1;
  storyNote.hidden = !isStory;
  storyNote.textContent = hasCarousel
    ? 'Solo stories en vídeo. Selecciona una para descargar.'
    : 'Story en vídeo lista para descargar.';
  carouselControls.classList.toggle('visible', hasCarousel);
  carouselControls.setAttribute('aria-hidden', String(!hasCarousel));
  carouselPosition.textContent = hasCarousel
    ? `${isStory ? 'Story ' : ''}${currentCarouselIndex + 1} / ${videos.length}`
    : '';
  carouselPrevious.setAttribute('aria-label', isStory ? 'Story anterior' : 'Vídeo anterior');
  carouselNext.setAttribute('aria-label', isStory ? 'Story siguiente' : 'Vídeo siguiente');
  carouselPrevious.disabled = !hasCarousel || currentCarouselIndex === 0;
  carouselNext.disabled = !hasCarousel || currentCarouselIndex === videos.length - 1;

  renderQualityOptions(animate);
  downloadComplete.classList.remove('visible');
  downloadProgress.classList.remove('visible');
  syncBackgroundState({ ...currentVideoInfo, thumbnail: video.thumbnail });
}

// ─── Show Error ─────────────────────────────────────────────
function showError(msg) {
  errorText.textContent = msg;
  errorMessage.classList.add('visible');
}

function hideError() {
  errorMessage.classList.remove('visible');
}

// ─── Set Loading State ──────────────────────────────────────
function setAnalyzing(loading) {
  analyzeStatus.classList.toggle('visible', loading);
  analyzeStatus.setAttribute('aria-hidden', String(!loading));
  if (loading) {
    analyzeStatusText.textContent = getInstagramStorySource(urlInput.value.trim())
      ? 'Buscando stories...'
      : 'Analizando enlace...';
    urlInput.disabled = true;
  } else {
    urlInput.disabled = false;
  }
  syncClearButtonState();
}

// ─── Render Quality Options ─────────────────────────────────
function renderQualityOptions(animateGrid = false) {
  const shouldAnimateGrid = animateGrid && resultsPanel.classList.contains('visible');
  const previousHeight = shouldAnimateGrid
    ? qualityGrid.getBoundingClientRect().height
    : null;

  if (qualityGridHeightAnimation) {
    qualityGridHeightAnimation.cancel();
    qualityGridHeightAnimation = null;
    qualityGrid.style.removeProperty('overflow');
  }

  qualityGrid.innerHTML = '';

  if (!currentVideoInfo) return;

  let options = [];

  const selectedVideo = getSelectedVideoInfo();
  if (!selectedVideo) return;

  if (currentFormat === 'mp3') {
    options = [...(currentVideoInfo.audioQualities || [])]
      .sort((a, b) => Number(b.kbps) - Number(a.kbps))
      .map(q => ({
        value: q.value,
        label: `${q.kbps} kbps`,
        desc: q.label.split('(')[1]?.replace(')', '') || ''
      }));
  } else {
    options = (selectedVideo.videoFormats || currentVideoInfo.videoFormats || []).map(f => ({
      value: String(f.height),
      label: f.label,
      desc: getVideoResolutionDescription(f.label)
    }));
  }

  options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'quality-option';

    const inputId = `quality-${currentFormat}-${opt.value}`;
    const isDefaultSelected = currentFormat === 'mp3'
      ? i === 0
      : i === 0;
    const checked = isDefaultSelected ? 'checked' : '';

    div.innerHTML = `
      <input type="radio" name="quality" id="${inputId}" value="${opt.value}" ${checked}>
      <label for="${inputId}" class="quality-option__label">
        <span class="quality-option__value">${opt.label}</span>
        ${opt.desc ? `<span class="quality-option__desc">${opt.desc}</span>` : ''}
      </label>
    `;

    qualityGrid.appendChild(div);
  });

  // Set default quality
  const firstRadio = qualityGrid.querySelector('input[type="radio"]');
  if (firstRadio) {
    currentQuality = firstRadio.value;
  }

  // Listen for quality changes
  qualityGrid.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      currentQuality = e.target.value;
    });
  });

  // Shared spotlight effect on the grid based on mouse position
  if (qualityGrid) {
    const labels = [...qualityGrid.querySelectorAll('.quality-option__label')];

    qualityGrid.onmousemove = (event) => {
      const rect = qualityGrid.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;

      qualityGrid.style.setProperty('--mouse-x', `${x}%`);
      qualityGrid.style.setProperty('--mouse-y', `${y}%`);

      labels.forEach(label => {
        const labelRect = label.getBoundingClientRect();
        const labelCenterX = (labelRect.left + labelRect.width / 2);
        const labelCenterY = (labelRect.top + labelRect.height / 2);
        const distanceX = Math.abs(event.clientX - labelCenterX);
        const distanceY = Math.abs(event.clientY - labelCenterY);
        const distance = Math.hypot(distanceX, distanceY);
        const influence = Math.max(0, 1 - distance / 120);

        label.style.setProperty('--mouse-x', `${((event.clientX - labelRect.left) / labelRect.width) * 100}%`);
        label.style.setProperty('--mouse-y', `${((event.clientY - labelRect.top) / labelRect.height) * 100}%`);
        label.style.setProperty('--spotlight-strength', influence.toFixed(3));
      });
    };

    qualityGrid.onmouseleave = () => {
      qualityGrid.style.setProperty('--mouse-x', '50%');
      qualityGrid.style.setProperty('--mouse-y', '50%');
      labels.forEach(label => {
        label.style.setProperty('--mouse-x', '50%');
        label.style.setProperty('--mouse-y', '50%');
        label.style.setProperty('--spotlight-strength', '0');
      });
    };
  }

  // Update download button text
  updateDownloadBtn();

  if (previousHeight !== null) {
    const nextHeight = qualityGrid.getBoundingClientRect().height;

    if (Math.abs(nextHeight - previousHeight) > 1) {
      qualityGrid.style.overflow = 'hidden';

      const animation = qualityGrid.animate(
        [
          { height: `${previousHeight}px` },
          { height: `${nextHeight}px` }
        ],
        {
          duration: 420,
          easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
        }
      );
      qualityGridHeightAnimation = animation;

      animation.addEventListener('finish', () => {
        if (qualityGridHeightAnimation === animation) {
          qualityGridHeightAnimation = null;
          qualityGrid.style.removeProperty('overflow');
        }
      }, { once: true });
    }
  }
}

// ─── Update Download Button ─────────────────────────────────
function updateDownloadBtn() {
  const formatLabel = currentFormat.toUpperCase();
  const videos = getCarouselVideos();
  const carouselLabel = isInstagramStory()
    ? ` · Story ${currentCarouselIndex + 1}`
    : videos.length > 1 ? ` · Vídeo ${currentCarouselIndex + 1}` : '';
  const textSpan = document.getElementById('downloadBtnText');
  if (textSpan) {
    textSpan.textContent = `Descargar ${formatLabel}${carouselLabel}`;
  }
}

// ─── Analyze Video ──────────────────────────────────────────
async function analyzeVideo() {
  const url = urlInput.value.trim();
  syncBackgroundState();

  if (!url) {
    showError('Por favor, pega un enlace de YouTube, X, Instagram, TikTok, Reddit o Twitch');
    urlInput.focus();
    return;
  }

  if (!isValidDownloadURL(url)) {
    showError('Pega un enlace de vídeo válido de YouTube, X, Instagram, TikTok, Reddit o Twitch.');
    return;
  }

  hideError();
  inputHint.textContent = defaultInputHint;
  inputHint.classList.remove('is-notice');
  setAnalyzing(true);
  resultsPanel.classList.remove('visible');
  downloadComplete.classList.remove('visible');
  downloadProgress.classList.remove('visible');

  try {
    await instagramAccount.ready;
    await instagramAccount.refresh();
    const response = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...instagramAccount.requestHeaders() },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Error al analizar el video');
    }

    currentVideoInfo = await response.json();
    currentVideoInfo.url = url;
    currentCarouselIndex = currentVideoInfo.platform === 'instagram' && !isInstagramStory()
      ? getInitialCarouselVideoIndex(getCarouselVideos(), url)
      : 0;

    // Render quality options for default format
    currentFormat = 'mp4';
    formatToggle.classList.add('mp4-active');
    formatToggle.querySelectorAll('.format-toggle__btn').forEach(b => {
      b.classList.toggle('active', b.dataset.format === 'mp4');
    });
    renderSelectedVideo();

    // Show results with animation
    resultsPanel.classList.add('visible');

  } catch (err) {
    showError(err.message);
  } finally {
    setAnalyzing(false);
  }
}

// ─── Download File (Job-based) ──────────────────────────────
async function downloadFile() {
  if (isDownloading || !currentVideoInfo) return;
  const selectedVideo = getSelectedVideoInfo();
  if (!selectedVideo) return;

  isDownloading = true;
  syncClearButtonState();
  downloadBtn.disabled = true;
  downloadBtn.classList.add('downloading');
  downloadComplete.classList.remove('visible');
  downloadProgress.classList.add('visible');
  progressBar.style.animation = 'none';
  progressBar.style.width = '0%';
  progressBar.style.marginLeft = '0';
  progressPercent.textContent = '0%';
  progressText.textContent = 'Iniciando preparación...';

  try {
    await instagramAccount.refresh();
    if (!currentVideoInfo) throw new Error('La cuenta de Instagram ha cambiado. Vuelve a analizar el enlace.');
    // 1. Iniciar el job en el servidor
    const startRes = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...instagramAccount.requestHeaders() },
      body: JSON.stringify({
        url: currentVideoInfo.url,
        format: currentFormat,
        quality: currentQuality,
        playlistItem: currentVideoInfo.platform === 'instagram' && !isInstagramStory()
          ? selectedVideo.playlistItem
          : null,
        ...(isInstagramStory() ? { videoId: selectedVideo.id } : {})
      })
    });

    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(err.error || 'Error al iniciar la descarga');
    }

    const { jobId } = await startRes.json();
    console.log(`Download job started: ${jobId}, format: ${currentFormat}, quality: ${currentQuality}`);

    // 2. Polling del progreso
    await new Promise((resolve, reject) => {
      pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/status/${jobId}`);

          if (!statusRes.ok) {
            throw new Error('Error al consultar el estado');
          }

          const status = await statusRes.json();

          // Actualizar UI de progreso
          updateProgressUI(status);

          if (status.status === 'ready') {
            clearInterval(pollInterval);
            pollInterval = null;

            // 3. Descargar archivo directamente (sin blob buffering)
            progressText.textContent = 'Archivo preparado · Guardando en tu equipo...';
            progressBar.style.width = '100%';
            progressPercent.textContent = '100%';

            // Crear enlace directo — el navegador maneja la descarga nativamente
            const a = document.createElement('a');
            a.href = `/api/file/${jobId}`;
            a.download = status.filename || `download.${status.format}`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            resolve();
          } else if (status.status === 'error') {
            clearInterval(pollInterval);
            pollInterval = null;
            reject(new Error(status.error || 'Error al descargar'));
          }
        } catch (err) {
          clearInterval(pollInterval);
          pollInterval = null;
          reject(err);
        }
      }, 1500); // Polling cada 1.5 segundos
    });

    // 4. Mostrar éxito
    downloadProgress.classList.remove('visible');
    downloadComplete.classList.add('visible');
    completeText.textContent = `Descarga ${currentFormat.toUpperCase()} iniciada · Revisa tu navegador`;

  } catch (err) {
    downloadProgress.classList.remove('visible');
    showError(err.message);
  } finally {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    isDownloading = false;
    syncClearButtonState();
    downloadBtn.disabled = false;
    downloadBtn.classList.remove('downloading');
  }
}

// ─── Update Progress UI ────────────────────────────────────
function updateProgressUI(status) {
  const percent = parseInt(status.progress) || 0;

  // Animate the progress bar to the current percentage
  progressBar.style.animation = 'none';
  progressBar.style.width = `${Math.min(percent, 100)}%`;
  progressBar.style.marginLeft = '0';
  progressPercent.textContent = status.progress || '0%';

  // Status-specific text
  if (status.progressDetail) {
    progressText.textContent = status.progressDetail;
  }

  // Change progress bar color for converting state
  if (status.status === 'converting') {
    progressBar.classList.add('converting');
  } else {
    progressBar.classList.remove('converting');
  }
}

// ─── Event Listeners ────────────────────────────────────────

// Complete pasted/dropped links analyze immediately; stories typed by hand wait for Enter.
urlInput.addEventListener('input', (event) => {
  inputRevision += 1;
  clearTimeout(analyzeTimeout);
  inputHint.textContent = defaultInputHint;
  inputHint.classList.remove('is-notice');
  syncClearButtonState();
  syncBackgroundState();

  const value = urlInput.value.trim();
  if (!value) return;

  const insertedCompleteLink = event.inputType === 'insertFromPaste'
    || event.inputType === 'insertFromDrop';

  if (!insertedCompleteLink && (getInstagramStorySource(value) || value.startsWith('@'))) {
    inputHint.textContent = 'Pulsa Enter para buscar las stories en vídeo.';
    inputHint.classList.add('is-notice');
    return;
  }

  if (!isValidDownloadURL(value)) {
    analyzeTimeout = setTimeout(() => {
      const currentValue = urlInput.value.trim();
      if (currentValue && !isValidDownloadURL(currentValue)) {
        showError('Pega un enlace de vídeo válido de YouTube, X, Instagram, TikTok, Reddit o Twitch.');
      }
    }, 500);
    return;
  }

  if (insertedCompleteLink) {
    analyzeTimeout = null;
    analyzeVideo();
    return;
  }

  analyzeTimeout = setTimeout(() => {
    analyzeTimeout = null;
    analyzeVideo();
  }, 120);
});

urlInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing || urlInput.disabled || isDownloading) return;
  event.preventDefault();
  clearTimeout(analyzeTimeout);
  analyzeTimeout = null;
  analyzeVideo();
});

urlClearButton.addEventListener('click', () => {
  resetInterface();
});

urlPasteButton.addEventListener('click', pasteLink);

homeReset.addEventListener('click', (event) => {
  event.preventDefault();
  resetInterface();
});

carouselPrevious.addEventListener('click', () => {
  if (isDownloading || currentCarouselIndex <= 0) return;
  currentCarouselIndex -= 1;
  renderSelectedVideo(true, -1);
});

carouselNext.addEventListener('click', () => {
  const videos = getCarouselVideos();
  if (isDownloading || currentCarouselIndex >= videos.length - 1) return;
  currentCarouselIndex += 1;
  renderSelectedVideo(true, 1);
});

// Format toggle buttons
formatToggle.querySelectorAll('.format-toggle__btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isDownloading) return; // No cambiar formato durante descarga

    // Update active state
    formatToggle.querySelectorAll('.format-toggle__btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update format and slider animation
    currentFormat = btn.dataset.format;
    if (currentFormat === 'mp4') {
      formatToggle.classList.add('mp4-active');
    } else {
      formatToggle.classList.remove('mp4-active');
    }
    
    renderQualityOptions(true);

    // Hide previous status
    downloadComplete.classList.remove('visible');
    downloadProgress.classList.remove('visible');
  });
});

// Download button
downloadBtn.addEventListener('click', downloadFile);

// Initialize with the same resting appearance as the content view.
initializeProfileSystem();
initializeHomepage();
syncBackgroundState();
syncClearButtonState();
window.addEventListener('pageshow', () => {
  syncBackgroundState();
  syncClearButtonState();
});
