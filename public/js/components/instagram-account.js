import { apiFetch, isNativeApp } from '../platform.js';

const SESSION_ENDPOINT = '/api/instagram/session';
const ACCOUNT_ENDPOINT = '/api/instagram/';
const CONNECTION_SIGNAL = 'instagram-connection-changed';
const INSTAGRAM_LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const BRIDGE_REQUEST = 'downlink-instagram-capture';
const BRIDGE_RESPONSE = 'downlink-instagram-capture-result';

export function initializeInstagramAccount({ onChange } = {}) {
  const button = document.getElementById('instagramAccountButton');
  const label = document.getElementById('instagramAccountLabel');
  const dialog = document.getElementById('instagramAccountDialog');
  const connectionStatus = document.getElementById('instagramAccountConnectionStatus');
  const title = document.getElementById('instagramAccountTitle');
  const description = document.getElementById('instagramAccountDescription');
  const stateMessage = document.getElementById('instagramAccountState');
  const errorMessage = document.getElementById('instagramAccountError');
  const closeButton = document.getElementById('instagramAccountClose');
  const startButton = document.getElementById('instagramAccountStart');
  const completeButton = document.getElementById('instagramAccountComplete');
  const cancelButton = document.getElementById('instagramAccountCancel');
  const disconnectButton = document.getElementById('instagramAccountDisconnect');

  let session = {
    available: null, connected: false, pending: false,
    expiresAt: null, csrfToken: '', captureToken: '',
  };
  let loaded = false;
  let busy = false;
  let operation = null;
  let operationSettled = null;
  let requestRevision = 0;
  let refreshPromise = null;
  let pollTimer = null;
  let expiryTimer = null;
  let closeTimer = null;
  let connectionChannel = null;
  let returnFocus = null;
  let closeRequested = false;
  let notice = '';

  function requestHeaders() {
    return session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {};
  }

  function showError(message = '') {
    if (errorMessage.textContent !== message) errorMessage.textContent = message;
    errorMessage.hidden = !message;
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function connectedDescription() {
    const description = 'La sesión está conectada. El acceso a cada vídeo depende de los permisos de tu cuenta y de su disponibilidad.';
    const expiry = session.expiresAt ? new Date(session.expiresAt) : null;
    if (!expiry || !Number.isFinite(expiry.getTime())) {
      return `${description} Puedes desconectarla cuando quieras.`;
    }
    const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(expiry);
    return `${description} La conexión caduca a las ${time}.`;
  }

  function connectionPresentation() {
    if (!loaded) {
      return { state: 'loading', label: 'Comprobando conexión…', title: 'Cuenta de Instagram.' };
    }
    if (session.connected) {
      return { state: 'connected', label: 'Conectada', title: 'Instagram está conectado.' };
    }
    if (session.pending) {
      return { state: 'pending', label: 'Inicio de sesión pendiente', title: 'Termina de conectar Instagram.' };
    }
    if (session.available === false) {
      return { state: 'unavailable', label: 'No disponible en este equipo', title: 'Conexión no disponible.' };
    }
    if (session.available === null) {
      return { state: 'error', label: 'No se pudo comprobar', title: 'No se pudo comprobar la conexión.' };
    }
    return { state: 'disconnected', label: 'No conectada', title: 'Conecta Instagram.' };
  }

  function render() {
    const focusedControl = document.activeElement;
    const working = Boolean(operation);
    const connection = connectionPresentation();
    button.disabled = busy || working;
    button.classList.toggle('is-connected', session.connected);
    button.dataset.connectionState = connection.state;
    button.setAttribute('aria-label', `Conectar Instagram: ${connection.label}`);
    setText(label, connection.label);
    dialog.dataset.connectionState = connection.state;
    setText(connectionStatus, connection.label);
    dialog.setAttribute('aria-busy', String(working));

    setText(title, connection.title);
    setText(description, session.connected
      ? connectedDescription()
      : `Inicia sesión directamente en Instagram. Tu sesión se guardará temporalmente en ${isNativeApp() ? 'este dispositivo' : 'este equipo'} para descargar vídeos que tu cuenta pueda ver.`);

    let status = notice;
    if (!loaded) status = 'Comprobando la conexión…';
    else if (session.available === false) status = 'La conexión está disponible al abrir la aplicación en el equipo donde se ejecuta.';
    else if (operation === 'login/start') status = isNativeApp() ? 'Abriendo Instagram…' : 'Abriendo una pestaña de Instagram…';
    else if (operation === 'login/capture') status = 'Recuperando la sesión desde la pestaña de Instagram…';
    else if (operation === 'login/complete') status = 'Comprobando tu inicio de sesión…';
    else if (operation === 'disconnect') status = 'Desconectando tu cuenta…';
    else if (session.pending) status = isNativeApp()
      ? 'Completa el inicio de sesión en Instagram y confirma la conexión.'
      : 'Completa el inicio de sesión en Instagram. Al volver a esta pestaña comprobaremos la conexión automáticamente.';
    setText(stateMessage, status);
    stateMessage.hidden = !status;

    startButton.hidden = !loaded || session.available === false || session.connected || session.pending;
    startButton.textContent = session.available === null ? 'Volver a intentar' : 'Abrir Instagram';
    completeButton.hidden = !session.pending;
    cancelButton.hidden = !session.pending;
    disconnectButton.hidden = !session.connected;
    for (const control of [startButton, completeButton, cancelButton, disconnectButton]) {
      control.disabled = busy || working;
    }
    if (dialog.open && focusedControl instanceof HTMLButtonElement && dialog.contains(focusedControl) && focusedControl.hidden) {
      title.focus({ preventScroll: true });
    }
  }

  function applySession(value, { notify = true, reason = 'refresh' } = {}) {
    if (!value || typeof value.available !== 'boolean' || typeof value.connected !== 'boolean') {
      throw new Error('No se pudo comprobar la conexión con Instagram. Vuelve a intentarlo.');
    }
    const expiresAt = value.expiresAt ? new Date(value.expiresAt).getTime() : null;
    const expired = Number.isFinite(expiresAt) && expiresAt <= Date.now();
    const connected = value.connected && !expired;
    const csrfToken = typeof value.csrfToken === 'string' ? value.csrfToken : '';
    const changed = session.connected !== connected
      || (session.connected && connected && session.csrfToken !== csrfToken);
    const wasPending = session.pending;
    const wasConnected = session.connected;
    session = {
      available: value.available,
      connected,
      pending: value.pending === true && !expired,
      expiresAt: expired ? null : value.expiresAt ?? null,
      csrfToken,
      captureToken: typeof value.captureToken === 'string' ? value.captureToken : '',
    };
    loaded = true;
    if (wasPending && !session.pending && !session.connected && !operation) {
      notice = 'La conexión se ha cancelado o ha caducado. Puedes volver a abrir Instagram.';
    } else if (wasConnected && !session.connected && !operation) {
      notice = 'La sesión ha caducado. Conecta Instagram de nuevo para continuar.';
    }
    render();
    scheduleExpiry();
    if (notify && changed) onChange?.({ connected: session.connected, reason });
  }

  async function readResponse(response) {
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error('No se pudo contactar con la aplicación. Comprueba que siga abierta y vuelve a intentarlo.');
    }
    if (!response.ok) {
      throw new Error(typeof value.error === 'string' ? value.error : 'No se pudo conectar Instagram. Vuelve a intentarlo.');
    }
    return value;
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePolling() {
    stopPolling();
    if (!dialog.open || !session.pending || operation) return;
    pollTimer = setTimeout(async () => {
      await refresh();
      schedulePolling();
    }, 2000);
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    expiryTimer = null;
    if ((!session.connected && !session.pending) || !session.expiresAt) return;
    const expiresAt = new Date(session.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return;
    expiryTimer = setTimeout(() => {
      // Clear private previews at the known expiry even if the server is unreachable.
      if (Date.now() >= expiresAt) {
        applySession({ ...session, connected: false, pending: false, expiresAt: null, csrfToken: '' });
      }
      void refresh({ fresh: true });
    }, Math.min(2_147_483_647, Math.max(1, expiresAt - Date.now() + 30)));
  }

  function readSession({ notify = true, clearError = true } = {}) {
    if (refreshPromise) return refreshPromise;
    const revision = ++requestRevision;
    refreshPromise = (async () => {
      try {
        const response = await apiFetch(SESSION_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
        const value = await readResponse(response);
        if (revision === requestRevision) {
          if (clearError) showError();
          applySession(value, { notify });
        }
      } catch (error) {
        if (revision === requestRevision) {
          loaded = true;
          showError(error instanceof TypeError ? 'No se pudo contactar con la aplicación. Vuelve a intentarlo.' : error.message);
          render();
        }
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function refresh({ fresh = false } = {}) {
    // Account mutations rotate the cookie and CSRF token together. Read their final state.
    while (operationSettled) await operationSettled;
    if (fresh && refreshPromise) await refreshPromise;
    while (operationSettled) await operationSettled;
    return readSession();
  }

  async function mutate(action, { closing = false } = {}) {
    if (operation || (busy && !closing)) return;
    operation = action;
    let finishOperation;
    operationSettled = new Promise((resolve) => { finishOperation = resolve; });
    notice = '';
    stopPolling();
    showError();
    render();

    try {
      // Reserve the action before waiting so a second click cannot start another login.
      await readSession();
      if (!session.csrfToken || !session.available) return;
      if (closeRequested && action === 'login/start') return;
      requestRevision += 1;
      const response = await apiFetch(`${ACCOUNT_ENDPOINT}${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...requestHeaders() },
        body: '{}',
      });
      const value = await readResponse(response);
      requestRevision += 1;
      const reason = ['login/complete', 'login/start'].includes(action) && value.connected
        ? 'connected'
        : action === 'disconnect' ? 'disconnected' : 'refresh';
      applySession(value, { reason });
      if (action === 'login/complete' || action === 'disconnect') {
        connectionChannel?.postMessage(CONNECTION_SIGNAL);
      }
      if (action === 'disconnect') notice = 'Tu cuenta se ha desconectado de esta aplicación.';
      if (action === 'login/cancel') notice = 'Conexión cancelada.';
    } catch (error) {
      showError(error instanceof TypeError ? 'No se pudo contactar con la aplicación. Vuelve a intentarlo.' : error.message);
      // Refresh the CSRF token and pending state after an expired or failed request.
      await readSession({ clearError: false });
    } finally {
      operation = null;
      operationSettled = null;
      finishOperation();
      render();
      if (closeRequested && session.pending && action !== 'login/cancel') {
        await mutate('login/cancel', { closing: true });
      }
      restoreFocus();
      schedulePolling();
    }
  }

  function openInstagramTab() {
    const loginTab = window.open(INSTAGRAM_LOGIN_URL, '_blank');
    if (!loginTab) {
      showError('El navegador ha bloqueado la pestaña de Instagram. Permite las ventanas emergentes para Downlink y vuelve a intentarlo.');
      return false;
    }
    try { loginTab.opener = null; } catch { /* The tab is already isolated by the browser. */ }
    return true;
  }

  function captureInstagramSession() {
    if (!session.captureToken) {
      return Promise.reject(new Error('La conexión ha caducado. Cancélala y abre Instagram de nuevo.'));
    }
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const endpoint = new URL(`${ACCOUNT_ENDPOINT}login/import`, window.location.href).href;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('No se detectó el puente de Instagram. Instala la extensión local incluida con Downlink y vuelve a confirmar.'));
      }, 6000);
      function onMessage(event) {
        if (event.source !== window || event.origin !== window.location.origin
            || event.data?.type !== BRIDGE_RESPONSE || event.data?.requestId !== requestId) return;
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        if (event.data.ok) resolve();
        else reject(new Error(event.data.error || 'No se pudo recuperar la sesión de Instagram.'));
      }
      window.addEventListener('message', onMessage);
      window.postMessage({
        type: BRIDGE_REQUEST, requestId, endpoint, captureToken: session.captureToken,
      }, window.location.origin);
    });
  }

  function startLogin() {
    if (isNativeApp()) {
      void mutate('login/start');
      return;
    }
    if (busy || operation || session.pending || !openInstagramTab()) return;
    void mutate('login/start');
  }

  async function completeLogin() {
    if (isNativeApp() || !session.captureToken) {
      await mutate('login/complete');
      return;
    }
    if (busy || operation) return;
    operation = 'login/capture';
    notice = '';
    showError();
    render();
    let captured = false;
    try {
      await captureInstagramSession();
      captured = true;
    } catch (error) {
      showError(error.message);
    } finally {
      operation = null;
      render();
    }
    if (closeRequested) {
      if (session.pending) await mutate('login/cancel', { closing: true });
      return;
    }
    if (captured) await mutate('login/complete');
  }

  function restoreFocus() {
    if (dialog.open || operation || !returnFocus) return;
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected && !returnFocus.hasAttribute('disabled')) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  function close() {
    closeRequested = true;
    stopPolling();
    if (dialog.open && !dialog.classList.contains('is-closing')) {
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
    if (session.pending && !operation) void mutate('login/cancel', { closing: true });
  }

  async function open() {
    if (busy || operation || dialog.open) return;
    window.clearTimeout(closeTimer);
    closeTimer = null;
    dialog.classList.remove('is-closing');
    closeRequested = false;
    const activeControl = document.activeElement;
    const menuButton = document.getElementById('optionsMenuButton');
    returnFocus = button.closest('[role="menu"]') && menuButton ? menuButton : activeControl;
    notice = '';
    showError();
    render();
    dialog.showModal();
    title.focus();
    await refresh();
    schedulePolling();
  }

  button.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  startButton.addEventListener('click', startLogin);
  completeButton.addEventListener('click', () => { void completeLogin(); });
  cancelButton.addEventListener('click', () => { void mutate('login/cancel'); });
  disconnectButton.addEventListener('click', () => { void mutate('disconnect'); });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) close();
  });
  dialog.addEventListener('close', () => {
    window.clearTimeout(closeTimer);
    closeTimer = null;
    dialog.classList.remove('is-closing');
    stopPolling();
    restoreFocus();
  });

  async function refreshVisibleSession() {
    if (document.visibilityState !== 'visible') return;
    await refresh({ fresh: true });
    if (!dialog.open || closeRequested || busy || operation
        || !session.pending || !session.captureToken) return;
    await completeLogin();
  }

  window.addEventListener('focus', () => { void refreshVisibleSession(); });
  document.addEventListener('visibilitychange', () => { void refreshVisibleSession(); });
  if (typeof BroadcastChannel === 'function') {
    try {
      connectionChannel = new BroadcastChannel(CONNECTION_SIGNAL);
      connectionChannel.addEventListener('message', (event) => {
        if (event.data === CONNECTION_SIGNAL) void refresh({ fresh: true });
      });
    } catch {
      // Focus, visibility and pre-request refresh also work when channels are unavailable.
    }
  }

  render();
  const ready = readSession({ notify: false });
  return {
    ready,
    open,
    refresh,
    requestHeaders,
    setBusy(value) {
      busy = Boolean(value);
      render();
    },
  };
}
