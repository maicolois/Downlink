let decoderPromise;

function loadDecoder() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  decoderPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/js/vendor/jsqr.js';
    script.onload = () => window.jsQR ? resolve(window.jsQR) : reject(new Error('No se pudo iniciar el lector QR.'));
    script.onerror = () => reject(new Error('No se pudo cargar el lector QR.'));
    document.head.append(script);
  }).catch(error => { decoderPromise = null; throw error; });
  return decoderPromise;
}

export function createQrScanner(video, { onCode, onError }) {
  let stream = null;
  let timer = null;
  let generation = 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  function stop() {
    generation += 1;
    clearTimeout(timer);
    timer = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
  }

  async function start() {
    stop();
    const current = generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !context) throw new Error('La cámara no está disponible. Introduce el código manualmente.');
      const cameraPromise = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      // Resolve camera first so a decoder failure cannot leave the camera running.
      const camera = await cameraPromise;
      if (current !== generation) { camera.getTracks().forEach(track => track.stop()); return; }
      stream = camera;
      const decode = await loadDecoder();
      if (current !== generation) return;
      video.srcObject = camera;
      video.hidden = false;
      await video.play();
      if (current !== generation) return;
      const scan = () => {
        if (current !== generation) return;
        try {
          if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            canvas.width = Math.min(video.videoWidth, 640);
            canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = decode(frame.data, frame.width, frame.height);
            if (result?.data) { stop(); onCode(result.data); return; }
          }
          timer = setTimeout(scan, 180);
        } catch {
          stop();
          onError('No se pudo leer el QR. Inténtalo de nuevo o introduce el código.');
        }
      };
      scan();
    } catch (error) {
      if (current !== generation) return;
      stop();
      onError(error?.name === 'NotAllowedError'
        ? 'Permite el acceso a la cámara o introduce el código manualmente.'
        : error?.message || 'No se pudo abrir la cámara. Introduce el código manualmente.');
    }
  }

  return { start, stop };
}
