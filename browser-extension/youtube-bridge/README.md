# Puente local de YouTube para Chrome

Chrome cifra las cookies de su perfil principal con App-Bound Encryption. Esta extensión permite que el propio Chrome entregue a Downlink únicamente las cookies de `youtube.com`. Puede conectar la sesión actual o abrir una ventana normal de inicio de sesión que se cierra automáticamente cuando YouTube confirma la cuenta.

## Instalar en Chrome

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona la carpeta `browser-extension/youtube-bridge` de Downlink.
5. Recarga Downlink.

Recarga la extensión desde `chrome://extensions` cada vez que actualices estos archivos. Después recarga Downlink.

La extensión no lee contraseñas, formularios ni cookies de otros sitios. Cada conexión necesita un token aleatorio de un solo uso, solo se acepta desde `localhost` y permanece dentro de este ordenador. La ventana de acceso es una ventana normal de Chrome; no está controlada por Playwright ni por otro software de automatización.
