const IOS_VIDEO_CODECS = new Set(['h264']);
const IOS_VIDEO_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);
const IOS_AUDIO_CODECS = new Set(['aac']);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildCompatibleMp4FormatSelector(quality) {
  const heightFilter = quality === 'best' ? '' : `[height<=${quality}]`;
  const bestVideo = `bestvideo${heightFilter}`;
  const best = `best${heightFilter}`;

  // Prefer streams that can be remuxed for Apple devices without a lengthy
  // video conversion. The final fallbacks retain support for sites that do not
  // expose codec metadata or do not offer H.264 at the requested resolution.
  return [
    `${bestVideo}[vcodec^=avc1]+bestaudio[ext=m4a]`,
    `${bestVideo}[vcodec^=h264]+bestaudio[acodec^=aac]`,
    `${bestVideo}[vcodec^=avc1]+bestaudio`,
    `${bestVideo}[vcodec^=h264]+bestaudio`,
    `${bestVideo}+bestaudio`,
    best,
    bestVideo,
    'best',
  ].join('/');
}

export function inspectAppleMp4Compatibility(streams = []) {
  const video = streams.find(stream => normalized(stream.codec_type) === 'video') || null;
  const audio = streams.find(stream => normalized(stream.codec_type) === 'audio') || null;
  const videoCodec = normalized(video?.codec_name);
  const pixelFormat = normalized(video?.pix_fmt);
  const audioCodec = normalized(audio?.codec_name);
  const videoCompatible = Boolean(video)
    && IOS_VIDEO_CODECS.has(videoCodec)
    && IOS_VIDEO_PIXEL_FORMATS.has(pixelFormat);
  const audioCompatible = !audio || IOS_AUDIO_CODECS.has(audioCodec);

  return {
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec,
    audioCodec,
    pixelFormat,
    needsVideoTranscode: Boolean(video) && !videoCompatible,
    needsAudioTranscode: Boolean(audio) && !audioCompatible,
    compatible: Boolean(video) && videoCompatible && audioCompatible,
  };
}

export function buildAppleCompatibleMp4Args({ inputPath, outputPath, streams }) {
  const compatibility = inspectAppleMp4Compatibility(streams);
  if (!compatibility.hasVideo) {
    throw new Error('El MP4 descargado no contiene una pista de vídeo.');
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
  ];

  if (compatibility.needsVideoTranscode) {
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'copy');
  }

  if (compatibility.hasAudio) {
    if (compatibility.needsAudioTranscode) {
      args.push('-c:a', 'aac', '-b:a', '192k');
    } else {
      args.push('-c:a', 'copy');
    }
  }

  args.push(
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    '-nostats',
    outputPath,
  );

  return { args, compatibility };
}
