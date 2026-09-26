import { isNativeApp } from './platform.js';

export function initializePwa() {
  if (isNativeApp()) return;
  const notice = document.getElementById('connectionNotice');
  const syncConnection = () => {
    notice.hidden = navigator.onLine;
    notice.textContent = 'Sin conexión. Vuelve a conectarte para preparar o guardar tus archivos.';
  };

  window.addEventListener('online', syncConnection);
  window.addEventListener('offline', syncConnection);
  syncConnection();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    const register = () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .catch(error => console.warn('No se pudo preparar el inicio sin conexión.', error));
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', register, { once: true });
  }
}
