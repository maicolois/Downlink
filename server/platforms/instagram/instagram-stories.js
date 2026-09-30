import { parseVideoInfoCollection } from '@/server/platforms/common/video-metadata.js';
import { isValidInstagramStoryVideoId } from '@/shared/instagram-stories.js';

export function storyUnavailableError() {
  return Object.assign(new Error('La story seleccionada ya no está disponible. Vuelve a analizar el usuario.'), {
    code: 'INSTAGRAM_STORY_UNAVAILABLE',
  });
}

export function parseInstagramStoryVideos(raw) {
  if (!raw.trim() || raw.trim() === 'null') {
    throw Object.assign(new Error('No se encontraron stories en vídeo.'), { code: 'INSTAGRAM_STORIES_EMPTY' });
  }
  let videos;
  try {
    videos = parseVideoInfoCollection(raw);
  } catch (error) {
    if (error.message === 'La publicación no contiene un vídeo descargable.') {
      error.code = 'INSTAGRAM_STORIES_EMPTY';
    }
    throw error;
  }
  // A stable extractor ID is required; a moving playlist index is not enough.
  if (videos.some(video => !isValidInstagramStoryVideoId(video.id))) {
    throw new Error('Instagram no devolvió un identificador válido para la story.');
  }
  return videos;
}

export function selectInstagramStory(info, videoId) {
  const videos = info.videos?.length ? info.videos : [info];
  const video = videos.find(candidate => candidate.id === videoId);
  if (!video) throw storyUnavailableError();
  return video;
}

export function getInstagramStoryError(error) {
  const message = String(error?.message || '');
  if (error?.code === 'INSTAGRAM_SESSION_EXPIRED') {
    return { status: 401, code: error.code, error: 'La sesión de Instagram ha caducado o se ha desconectado. Vuelve a conectar tu cuenta.' };
  }
  if (error?.code === 'INSTAGRAM_COOKIES_INVALID') {
    return { status: 503, code: error.code, error: 'La sesión de Instagram no está disponible. Revisa su configuración.' };
  }
  if (error?.code === 'INSTAGRAM_STORY_UNAVAILABLE') {
    return { status: 410, code: error.code, error: storyUnavailableError().message };
  }
  if (error?.code === 'INSTAGRAM_STORIES_EMPTY') {
    return {
      status: 404, code: error.code,
      error: 'No se encontraron stories en vídeo disponibles. Pueden haber caducado o ser fotografías.',
    };
  }
  if (/\b(?:HTTP(?:\s+Error)?|status(?:\s+code)?)\s*:?\s*429\b|too many requests|rate.?limit|please wait a few minutes/i.test(message)) {
    return { status: 429, code: 'INSTAGRAM_RATE_LIMITED', error: 'Instagram está limitando las solicitudes. Espera unos minutos y vuelve a intentarlo.' };
  }
  if (/log[ -]?in|sign[ -]?in|login_required|cookies?|\b(?:HTTP(?:\s+Error)?|status(?:\s+code)?)\s*:?\s*(?:401|403)\b|private|registered users|unreachable/i.test(message)) {
    return {
      status: 401, code: 'INSTAGRAM_LOGIN_REQUIRED',
      error: 'Instagram requiere una sesión válida con acceso a estas stories. Comprueba que puedas verlas con esa cuenta.',
    };
  }
  if (/no audio|does not contain any stream|stream map.*matches no streams/i.test(message)) {
    return { status: 422, code: 'INSTAGRAM_STORY_NO_AUDIO', error: 'Esta story no contiene audio. Descárgala en MP4.' };
  }
  if (/\b(?:HTTP(?:\s+Error)?|status(?:\s+code)?)\s*:?\s*404\b|not found|unavailable|not available|expired|does not exist|no video|no formats/i.test(message)) {
    return { status: 410, code: 'INSTAGRAM_STORY_UNAVAILABLE', error: storyUnavailableError().message };
  }
  return {
    status: 502, code: 'INSTAGRAM_STORIES_FAILED',
    error: 'No se pudieron obtener las stories. Comprueba que sigan disponibles e inténtalo de nuevo.',
  };
}
