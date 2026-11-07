import { animateOverlayEntrance, cancelOverlayEntrance } from '@/public/js/components/overlay-motion.js';
import { initializeAnimatedDisclosure } from '@/public/js/components/disclosure-motion.js';
import { initializeYouTubeExtensionHelp } from '@/public/js/components/youtube-extension-help.js';
import { createQrScanner } from '@/public/js/components/qr-scanner.js';

const STORAGE_KEY = 'downlink.youtube-browser.v1';
const LOGIN_START_REQUEST = 'downlink-youtube-login-start';
const LOGIN_CHECK_REQUEST = 'downlink-youtube-login-check';
const LOGIN_CANCEL_REQUEST = 'downlink-youtube-login-cancel';
const CAPTURE_RESPONSE = 'downlink-youtube-capture-result';
function readPreference() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { enabled: value?.browser === 'chrome' && value.enabled === true, browser: 'chrome' };
  } catch { /* Storage is optional. */ }
  return { enabled: false, browser: 'chrome' };
}

function requestChromeBridge({ type, endpoint, captureToken, timeoutMs = 5_000 }) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error('No se encontró la extensión. Sigue los pasos de instalación.'), { code: 'YOUTUBE_BRIDGE_MISSING' }));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    }
    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin
          || event.data?.type !== CAPTURE_RESPONSE || event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error || 'El navegador no pudo entregar la sesión local de YouTube.'));
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ type, requestId, endpoint, captureToken }, window.location.origin);
  });
}

export function initializeYouTubeAccount({ onConnect = () => {} } = {}) {
  const button = document.getElementById('youtubeAccountButton');
  const label = document.getElementById('youtubeAccountLabel');
  const dialog = document.getElementById('youtubeAccountDialog');
  const title = document.getElementById('youtubeAccountTitle');
  const description = document.getElementById('youtubeAccountDescription');
  const connectionStatus = document.getElementById('youtubeAccountConnectionStatus');
  const closeButton = document.getElementById('youtubeAccountClose');
  const browserNotice = document.getElementById('youtubeBrowserNotice');
  const browserNoticeText = document.getElementById('youtubeBrowserNoticeText');
  const bridgeHelp = document.getElementById('youtubeBridgeHelp');
  const enableButton = document.getElementById('youtubeBrowserEnable');
  const disableButton = document.getElementById('youtubeBrowserDisable');
  const pairingStart = document.getElementById('youtubePairingStart');
  const pairingPanel = document.getElementById('youtubePairingPanel');
  const pairingInstructions = document.getElementById('youtubePairingInstructions');
  const pairingLabel = document.getElementById('youtubePairingLabel');
  const pairingInput = document.getElementById('youtubePairingInput');
  const pairingCode = document.getElementById('youtubePairingCode');
  const pairingQr = document.getElementById('youtubePairingQr');
  const pairingScan = document.getElementById('youtubePairingScan');
  const pairingCamera = document.getElementById('youtubePairingCamera');
  const privacyText = document.getElementById('youtubePrivacyText');
  const controls = [button, label, dialog, title, description, connectionStatus,
    closeButton, browserNotice, browserNoticeText, bridgeHelp, enableButton, disableButton,
    pairingStart, pairingPanel, pairingInstructions, pairingLabel, pairingInput, pairingCode, pairingQr, pairingScan, pairingCamera, privacyText];

  if (!controls.every(Boolean)) {
    return { getBrowser: () => null, ready: Promise.resolve(), refresh: () => Promise.resolve(), open: () => {} };
  }

  const bridgeDisclosure = initializeAnimatedDisclosure(bridgeHelp);
  void initializeYouTubeExtensionHelp(bridgeHelp);
  let preference = readPreference();
  let chromeConnected = false;
  let busy = false;
  let waitingForLogin = false;
  let noticeError = '';
  let remote = window.location.protocol === 'https:';
  const insecureNetwork = window.location.protocol === 'http:'
    && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  let displayedCode = '';
  let secureOrigin = '';
  let pairingAvailable = false;
  let scanner = null;
  let scanning = false;
  let returnFocus = null;
  let closeTimer = null;

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preference)); } catch { /* Optional preference. */ }
  }

  function activeConnection() {
    return preference.enabled && chromeConnected;
  }

  function render() {
    const connected = activeConnection();
    const failed = Boolean(noticeError);
    const status = connected ? 'Sesión local activada' : 'No activada';
    button.classList.toggle('is-connected', connected);
    button.dataset.connectionState = connected ? 'connected' : 'disconnected';
    button.setAttribute('aria-label', `Sesión de YouTube: ${status}`);
    label.textContent = status;
    dialog.dataset.connectionState = connected ? 'connected' : failed ? 'error' : busy ? 'pending' : 'disconnected';
    connectionStatus.textContent = connected ? 'Cuenta conectada'
      : failed ? 'No se pudo conectar'
        : busy ? (waitingForLogin ? 'Esperando inicio de sesión…' : 'Conectando con YouTube…')
          : 'Ninguna cuenta conectada';
    title.textContent = connected ? 'YouTube conectado' : 'Conectar YouTube';
    description.textContent = remote && !connected
      ? 'Vincula este dispositivo con tu sesión de YouTube del ordenador.'
      : connected
      ? 'Tu cuenta ya está disponible para descargar vídeos.'
      : 'Para vídeos que requieren tu cuenta.';
    disableButton.hidden = !preference.enabled && !chromeConnected;
    disableButton.disabled = busy;
    enableButton.disabled = busy || insecureNetwork;
    enableButton.hidden = remote && connected;
    pairingStart.hidden = !connected || remote || insecureNetwork || !pairingAvailable;
    pairingStart.disabled = busy;
    pairingPanel.hidden = remote ? connected : !displayedCode;
    pairingLabel.hidden = !remote;
    pairingInput.hidden = !remote;
    pairingCode.hidden = remote || !displayedCode;
    pairingQr.hidden = remote || !displayedCode;
    pairingScan.hidden = !remote || connected;
    pairingScan.disabled = busy;
    pairingScan.textContent = scanning ? 'Cancelar escaneo' : 'Escanear QR';
    pairingCode.textContent = displayedCode;
    pairingInstructions.textContent = remote
      ? 'En el ordenador, abre Sesión de YouTube y pulsa Vincular iPhone. Escanea el QR o introduce el código.'
      : `Para abrirlo en Safari, escanea el QR con la app Cámara del iPhone y toca el enlace. Si ya tienes Downlink instalado, puedes escanearlo desde Sesión de YouTube o introducir este código. Caduca en 3 minutos.${/^https:\/\/\d+\.\d+\.\d+\.\d+/.test(secureOrigin) ? ` La primera vez, instala antes el certificado desde http://${new URL(secureOrigin).hostname}:3000/ios-setup.html.` : ''}`;
    privacyText.textContent = remote
      ? 'Las cookies de YouTube permanecen en el ordenador.'
      : 'Sesión local. Tu contraseña no sale del navegador.';

    browserNotice.classList.toggle('is-error', failed);
    browserNotice.hidden = !failed && !connected && !insecureNetwork;
    const notice = noticeError || (connected
      ? (remote ? 'Este iPhone está vinculado con el ordenador.' : 'Tu sesión está conectada. Puedes dejar el navegador abierto.')
      : insecureNetwork ? 'Para conectar YouTube desde el iPhone, abre la dirección segura de Downlink después de instalar el certificado.' : '');
    // Avoid repeating a live announcement when cleanup renders the same error.
    if (browserNoticeText.textContent !== notice) browserNoticeText.textContent = notice;
    if (connected) bridgeDisclosure.finish();
    bridgeHelp.hidden = connected || remote || insecureNetwork;

    enableButton.textContent = failed ? 'Volver a intentar' : busy
      ? (waitingForLogin ? 'Esperando inicio de sesión…' : 'Conectando…')
      : remote ? 'Vincular iPhone' : (connected ? 'Actualizar conexión' : 'Conectar YouTube');
  }

  async function refresh() {
    try {
      const response = await fetch('/api/youtube/session', { cache: 'no-store' });
      const state = await response.json().catch(() => ({}));
      if (state.remote === true) remote = true;
      pairingAvailable = state.pairingAvailable === true;
      chromeConnected = response.ok && state.connected === true;
      if (remote && chromeConnected) preference = { enabled: true, browser: 'chrome' };
      if (chromeConnected) {
        noticeError = '';
      } else if (preference.enabled && preference.browser === 'chrome' && !noticeError && !insecureNetwork && !remote) {
        noticeError = 'La sesión del navegador todavía no está conectada en este servidor.';
      }
      render();
      return state;
    } catch {
      chromeConnected = false;
      render();
      return { available: false, connected: false };
    }
  }

  async function connectChrome() {
    busy = true;
    waitingForLogin = false;
    noticeError = '';
    render();
    let request = null;
    let connected = false;
    try {
      const response = await fetch('/api/youtube/chrome/capture/start', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'login' }),
      });
      const state = await response.json().catch(() => ({}));
      if (!response.ok || typeof state.captureToken !== 'string') {
        throw new Error(state.error || 'Downlink no pudo preparar el inicio de sesión en el navegador.');
      }
      request = {
        endpoint: new URL('/api/youtube/chrome/capture/import', window.location.origin).href,
        captureToken: state.captureToken,
      };
      let result = await requestChromeBridge({ type: LOGIN_START_REQUEST, ...request });
      waitingForLogin = result.pending === true;
      render();
      const deadline = Date.now() + 5 * 60 * 1000;
      while (result.pending && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 750));
        result = await requestChromeBridge({ type: LOGIN_CHECK_REQUEST, ...request });
      }
      if (!result.connected) throw new Error('El tiempo para iniciar sesión en YouTube ha caducado.');
      await refresh();
      if (!chromeConnected) throw new Error('El navegador no pudo confirmar la sesión de YouTube.');
      preference = { enabled: true, browser: 'chrome' };
      noticeError = '';
      save();
      connected = true;
    } catch (error) {
      chromeConnected = false;
      noticeError = error instanceof TypeError
        ? 'No se pudo contactar con Downlink. Comprueba que siga abierto.'
        : error.message || 'No se pudo completar la conexión. Vuelve a intentarlo.';
      render();
      if (error.code === 'YOUTUBE_BRIDGE_MISSING') bridgeDisclosure.setOpen(true);
      requestAnimationFrame(() => {
        if (!dialog.open || !noticeError) return;
        const noticeBounds = browserNotice.getBoundingClientRect();
        const pageBounds = dialog.querySelector('.instagram-dialog__page').getBoundingClientRect();
        if (noticeBounds.top < pageBounds.top || noticeBounds.bottom > pageBounds.bottom) {
          browserNotice.scrollIntoView({ block: 'nearest', inline: 'nearest',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }
      });
    } finally {
      if (!chromeConnected && request) {
        await requestChromeBridge({
          type: LOGIN_CANCEL_REQUEST,
          timeoutMs: 1_000,
          ...request,
        }).catch(() => {});
      }
      busy = false;
      waitingForLogin = false;
      render();
    }
    return connected;
  }

  async function refreshForRequest() {
    if (preference.enabled || remote) await refresh();
  }

  async function disconnectChrome() {
    try {
      await fetch(remote ? '/api/youtube/pairing/disconnect' : '/api/youtube/disconnect', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } finally {
      chromeConnected = false;
      displayedCode = '';
    }
  }

  function close() {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    scanner?.stop();
    scanning = false;
    render();
    cancelOverlayEntrance(dialog);
    const finishClose = () => {
      closeTimer = null;
      dialog.classList.remove('is-closing');
      if (dialog.open) dialog.close();
    };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      finishClose();
    } else {
      dialog.classList.add('is-closing');
      closeTimer = window.setTimeout(finishClose, 160);
    }
  }

  function open({ preserveNotice = false } = {}) {
    if (dialog.open) return;
    window.clearTimeout(closeTimer);
    closeTimer = null;
    dialog.classList.remove('is-closing');
    const menuButton = document.getElementById('optionsMenuButton');
    returnFocus = button.closest('[role="menu"]') && menuButton ? menuButton : document.activeElement;
    if (!preserveNotice) noticeError = '';
    void refresh();
    render();
    dialog.showModal();
    animateOverlayEntrance(dialog);
    title.focus({ preventScroll: true });
  }

  button.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  async function connectPairing(code) {
    scanner?.stop();
    scanning = false;
    busy = true;
    noticeError = '';
    render();
    try {
      const response = await fetch('/api/youtube/pairing/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }), cache: 'no-store',
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || 'No se pudo vincular el iPhone.');
      preference = { enabled: true, browser: 'chrome' };
      save();
      await refresh();
      if (!chromeConnected) throw new Error('No se pudo confirmar la vinculación.');
      pairingInput.value = '';
      onConnect();
    } catch (error) {
      noticeError = error instanceof TypeError ? 'No se pudo conectar con el ordenador.' : error.message;
    } finally {
      busy = false;
      render();
    }
  }
  pairingScan.addEventListener('click', async () => {
    if (busy) return;
    if (scanning) {
      scanner?.stop();
      scanning = false;
      render();
      return;
    }
    scanner ||= createQrScanner(pairingCamera, {
      onCode(value) {
        scanning = false;
        let link;
        try { link = new URL(value); } catch { /* Show a helpful error below. */ }
        const code = link && link.origin === location.origin && link.pathname === '/'
          ? new URLSearchParams(link.hash.slice(1)).get('youtube-pair') : null;
        if (!/^\d{8}$/.test(code || '')) {
          noticeError = 'Este QR no corresponde a este ordenador. Genera otro en Downlink.';
          render();
          return;
        }
        void connectPairing(code);
      },
      onError(message) { scanning = false; noticeError = message; render(); },
    });
    scanning = true;
    noticeError = '';
    render();
    await scanner.start();
  });
  enableButton.addEventListener('click', async () => {
    if (busy || insecureNetwork) return;
    if (!remote) {
      if (await connectChrome()) onConnect();
      return;
    }
    await connectPairing(pairingInput.value.trim());
  });
  pairingStart.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    noticeError = '';
    render();
    try {
      const response = await fetch('/api/youtube/pairing/code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store',
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || 'No se pudo generar el código.');
      displayedCode = value.code;
      secureOrigin = value.origin;
      pairingQr.src = value.qr;
    } catch (error) {
      noticeError = error instanceof TypeError ? 'No se pudo conectar con Downlink.' : error.message;
    } finally {
      busy = false;
      render();
    }
  });
  disableButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    render();
    if (chromeConnected) await disconnectChrome();
    preference = { ...preference, enabled: false };
    noticeError = '';
    save();
    busy = false;
    render();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) close();
  });
  dialog.addEventListener('close', () => {
    scanner?.stop();
    scanning = false;
    cancelOverlayEntrance(dialog);
    window.clearTimeout(closeTimer);
    closeTimer = null;
    dialog.classList.remove('is-closing');
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  });
  window.addEventListener('pagehide', () => { scanner?.stop(); scanning = false; render(); });

  render();
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const pairingFromQr = remote && /^\d{8}$/.test(fragment.get('youtube-pair') || '')
    ? fragment.get('youtube-pair') : null;
  if (pairingFromQr) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  const ready = (async () => {
    await refresh();
    if (pairingFromQr && !chromeConnected) {
      await connectPairing(pairingFromQr);
      open({ preserveNotice: true });
    }
  })();
  return {
    ready,
    refresh: refreshForRequest,
    getBrowser: () => activeConnection() ? preference.browser : null,
    open,
    close,
  };
}
