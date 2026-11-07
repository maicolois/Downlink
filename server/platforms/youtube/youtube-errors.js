const BROWSER_LABELS = {
  brave: 'Brave',
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
};

function browserCookieDecryptionFailed(message) {
  return /failed\s+to\s+decrypt|\bDPAPI\b|app[-\s]?bound\s+encrypt/i.test(message);
}

export function getYouTubeError(error, { browser = null } = {}) {
  if (typeof error?.code === 'string' && error.code.startsWith('YOUTUBE_CHROME_')) {
    return {
      status: Number.isInteger(error.status) ? error.status : 401,
      code: error.code,
      error: error.message,
    };
  }
  if (error?.code === 'YOUTUBE_BROWSER_INVALID') {
    return { status: 400, code: error.code, error: error.message };
  }

  const raw = String(error?.message || '');
  // yt-dlp may print warnings about age or formats before the actual error.
  // Do not diagnose the failure using a warning when an error is available.
  const lines = raw.split(/\r?\n/);
  const errors = lines.filter(line => /\bERROR:/i.test(line));
  const message = errors.length ? errors.join('\n') : raw;
  const label = BROWSER_LABELS[browser] || 'el navegador seleccionado';

  if (browser && browserCookieDecryptionFailed(message)) {
    return {
      status: 422,
      code: 'YOUTUBE_BROWSER_DECRYPTION_FAILED',
      error: `Windows no permite leer las cookies de ${label}. Abre Downlink en Chrome y conecta YouTube mediante la extensión de Downlink.`,
    };
  }

  if (browser && /browser.*(?:not\s+found|is\s+not\s+installed)|profile.*(?:not\s+found|does\s+not\s+exist)|could\s+not\s+find.*cookies?/i.test(message)) {
    return {
      status: 422,
      code: 'YOUTUBE_BROWSER_SESSION_UNAVAILABLE',
      error: `No se encontró el perfil o las cookies de ${label}. Comprueba que el navegador esté instalado y que hayas iniciado sesión en YouTube en su perfil predeterminado.`,
    };
  }
  if (browser && /could\s+not\s+copy.*cookies?|cookie\s+database|secretstorage|keyring/i.test(message)) {
    return {
      status: 422,
      code: 'YOUTUBE_BROWSER_SESSION_UNAVAILABLE',
      error: `No se pudo leer la sesión de ${label}. El navegador o el sistema puede estar bloqueando el acceso; cierra ${label} por completo y vuelve a intentarlo.`,
    };
  }
  if (/confirm\s+you(?:'|’)re\s+not\s+a\s+bot|confirm\s+you\s+are\s+not\s+a\s+bot|unusual\s+traffic/i.test(message)) {
    return {
      status: 403, code: 'YOUTUBE_BOT_CHECK',
      error: 'YouTube solicita una comprobación de seguridad. Abre el vídeo en YouTube, completa la comprobación si aparece y vuelve a intentarlo. Si es necesario, conecta de nuevo tu sesión.',
    };
  }
  if (/age[-\s]?verification|verify\s+your\s+age|verif(?:y|ication).*\bage\b/i.test(message)) {
    return {
      status: 403, code: 'YOUTUBE_AGE_VERIFICATION_REQUIRED',
      error: 'YouTube solicita verificar la edad de la cuenta. Abre el vídeo en YouTube, completa allí la verificación que aparezca y vuelve a conectar la sesión.',
    };
  }
  if (/private\s+video|video\s+is\s+private/i.test(message)) {
    return { status: 403, code: 'YOUTUBE_PRIVATE', error: 'YouTube indica que el vídeo es privado. Solo podrás acceder con una cuenta autorizada por su propietario; comprueba que puedes verlo en YouTube y conecta esa cuenta.' };
  }
  if (/members?[-\s]?only|join\s+this\s+channel|channel\s+members/i.test(message)) {
    return { status: 403, code: 'YOUTUBE_MEMBERS_ONLY', error: 'YouTube indica que el vídeo es exclusivo para miembros. Comprueba que tu cuenta tenga acceso al canal y conecta esa cuenta.' };
  }
  if (/not\s+available\s+in\s+your\s+country|not\s+available\s+in\s+your\s+region|geo[-\s]?restricted|blocked\s+in\s+your\s+country/i.test(message)) {
    return { status: 403, code: 'YOUTUBE_GEO_RESTRICTED', error: 'YouTube indica que este vídeo no está disponible en tu país o región. Comprueba su disponibilidad directamente en YouTube.' };
  }
  if (/video\s+has\s+been\s+removed|video\s+has\s+been\s+deleted|account.*(?:terminated|closed)/i.test(message)) {
    return { status: 404, code: 'YOUTUBE_REMOVED', error: 'YouTube indica que el vídeo o la cuenta que lo publicó ya no están disponibles. Comprueba el enlace en YouTube.' };
  }
  if (/sign\s+in\s+to\s+confirm\s+your\s+age|confirm\s+your\s+age|age[-\s]?restricted/i.test(message)) {
    return browser ? {
      status: 401,
      code: 'YOUTUBE_AUTH_REQUIRED',
      error: `YouTube pide confirmar la edad y no ha aceptado la sesión de ${label}. Comprueba que esa cuenta pueda reproducir el vídeo y vuelve a conectar YouTube.`,
    } : {
      status: 401,
      code: 'YOUTUBE_AUTH_REQUIRED',
      error: 'Confirma tu edad en YouTube.',
    };
  }
  if (/sign\s+in|log\s*in|login\s+required|authentication\s+required/i.test(message)) {
    return { status: 401, code: 'YOUTUBE_AUTH_REQUIRED', error: browser
      ? `YouTube solicita una sesión autorizada y no ha aceptado la de ${label}. Comprueba el acceso al vídeo en YouTube y vuelve a conectar la cuenta.`
      : 'YouTube solicita iniciar sesión para acceder a este vídeo. Comprueba que tu cuenta puede reproducirlo y conecta YouTube.' };
  }
  if (/requested\s+format\s+(?:is\s+)?not\s+available|no\s+video\s+formats\s+found/i.test(message)) {
    return { status: 422, code: 'YOUTUBE_FORMAT_UNAVAILABLE', error: 'YouTube no ha proporcionado el formato o la calidad solicitados. Analiza de nuevo el vídeo y prueba otra calidad; si continúa, comprueba que tu sesión tenga acceso.' };
  }
  if (/\b(?:http\s+error\s*)?429\b|too\s+many\s+requests|rate[-\s]?limit/i.test(message)) {
    return { status: 429, code: 'YOUTUBE_RATE_LIMIT', error: 'YouTube ha limitado temporalmente las peticiones. Espera un tiempo y vuelve a intentarlo.' };
  }
  if (/\b(?:http\s+error\s*)403\b|forbidden/i.test(message)) {
    return { status: 403, code: 'YOUTUBE_ACCESS_DENIED', error: 'YouTube rechazó el acceso al archivo. La sesión o los enlaces pueden haber caducado; comprueba el vídeo en YouTube, vuelve a conectar la sesión si es necesario y analízalo de nuevo.' };
  }
  if (/timed?\s*out|temporary\s+failure\s+in\s+name\s+resolution|unable\s+to\s+resolve|connection\s+(?:reset|refused)|network\s+is\s+unreachable/i.test(message)) {
    return { status: 503, code: 'YOUTUBE_NETWORK_ERROR', error: 'No se pudo conectar con YouTube. Comprueba tu conexión a Internet y vuelve a intentarlo.' };
  }
  if (/video\s+unavailable|this\s+content\s+isn.t\s+available/i.test(message)) {
    return { status: 404, code: 'YOUTUBE_UNAVAILABLE', error: 'YouTube indica que el vídeo no está disponible, pero no ha explicado la causa. Abre el enlace en YouTube para comprobarlo.' };
  }
  return null;
}
