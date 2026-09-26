import { isIOSWebApp, isNativeApp } from './platform.js';

export function initializePwa() {
  if (isNativeApp()) return;
  const installButton = document.getElementById('pwaInstallButton');
  const dialog = document.getElementById('pwaInstallDialog');
  const closeButton = document.getElementById('pwaInstallClose');
  const notice = document.getElementById('connectionNotice');
  const standalone = window.matchMedia('(display-mode: standalone)');
  const syncInstall = () => {
    installButton.hidden = !isIOSWebApp() || standalone.matches || navigator.standalone === true;
  };
  const syncConnection = () => {
    notice.hidden = navigator.onLine;
    notice.textContent = 'Sin conexión. Vuelve a conectarte para preparar o guardar tus archivos.';
  };

  installButton.addEventListener('click', () => dialog.showModal());
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => document.getElementById('profileMenuButton').focus());
  standalone.addEventListener('change', syncInstall);
  window.addEventListener('online', syncConnection);
  window.addEventListener('offline', syncConnection);
  syncInstall();
  syncConnection();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    const register = () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .catch(error => console.warn('No se pudo preparar el inicio sin conexión.', error));
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', register, { once: true });
  }
}
