# Downlink

Conversor de YouTube, X, Instagram, TikTok, Reddit y Twitch a MP4 y MP3.

## Aplicación nativa para iPhone y iPad

La versión iOS es una aplicación SwiftUI autónoma. Incluye CPython, `yt-dlp`, WebKit como motor JavaScript y FFmpeg, por lo que descarga y convierte directamente en el iPhone sin arrancar Node ni depender de un servidor propio.

- Proyecto nativo: [`ios/`](ios/).
- **Preparación del Mac, firma e instalación:** [`ios/README.md`](ios/README.md).
- Los archivos terminados aparecen en `En mi iPhone/DOWNLINK/Downloads`.

## Aplicación web instalable para iPhone y iPad

La versión iOS embebida vuelve a estar disponible como PWA en una carpeta independiente. Reutiliza exactamente la interfaz web y se instala desde Safari mediante **Compartir → Añadir a pantalla de inicio**. El iPhone muestra la aplicación, mientras que el equipo o alojamiento que ejecuta Downlink prepara las descargas.

- PWA restaurada: [`ios-embedded/`](ios-embedded/).
- **Configuración, HTTPS e instalación:** [`ios-embedded/README.md`](ios-embedded/README.md).
- Pruebas: `npm run test:ios-embedded`.

## Aplicación Android · POCO X7 Pro

La versión Android funciona directamente en el móvil, con yt-dlp, Python, QuickJS y FFmpeg incluidos. No necesita arrancar Node ni conectar el teléfono a un servidor.

- Proyecto nativo: [`android/`](android/).
- **Instalación del APK en el POCO, compilación y pruebas:** [`android/README.md`](android/README.md).
- Compilar un APK firmado para uso personal: `./scripts/build-android.sh`.
- APK para el teléfono: `artifacts/Downlink-1.0.2-arm64-v8a.apk` (generado, excluido de Git). Instálalo como actualización para conservar el historial.
- Resultados de las pruebas: [`android/TEST_REPORT_1.0.2.md`](android/TEST_REPORT_1.0.2.md).

Incluye compartir enlaces hacia Downlink, vista previa automática al pegar un enlace, miniaturas en el historial, MP4/MP3 con selección de calidad, cola con notificaciones y cancelación, abrir/compartir archivos y conexión opcional a Instagram. Los archivos se guardan en `Download/Downlink`.

## Versión web original

```powershell
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Estructura del proyecto

```text
public/
  assets/       # Iconos y recursos gráficos públicos
  css/          # Estilos de la interfaz
  js/           # Código del navegador, separado por componentes y fondos
ios/            # App nativa SwiftUI para iPhone/iPad y motor local de descargas
ios-embedded/   # PWA instalable desde Safari; utiliza el servidor web compartido
references/
  backgrounds/  # Vídeos usados como referencia visual; no se sirven al navegador
server/
  auth/         # Autenticación y sesiones
  platforms/    # Integraciones organizadas por plataforma
  services/     # Servicios reutilizables del backend
shared/         # Código compartido entre navegador y servidor
tests/          # Pruebas automatizadas y sus fixtures
```

Los directorios `bin/` y `downloads/` se crean durante la ejecución y no se incluyen en Git. El fondo anterior se conserva como `public/js/backgrounds/wave-background.js` para poder reutilizarlo.

## Menú de opciones

La web se abre directamente en el conversor. El botón de tres puntos con efecto Liquid Glass, en la esquina superior derecha, contiene **Conectar Instagram**. La aplicación nativa iOS reproduce el mismo lenguaje visual y añade el acceso local a **Descargas**.

## Stories de Instagram

En el mismo campo puedes pegar:

- Una story: `https://www.instagram.com/stories/usuario/12345678901234567/`
- Las stories activas: `https://www.instagram.com/stories/usuario/`
- Un perfil: `https://www.instagram.com/usuario/`
- Una colección destacada: `https://www.instagram.com/stories/highlights/12345678901234567/`

También puedes escribir `@usuario` y pulsar Enter. Al pegar, el análisis empieza automáticamente. Las flechas permiten seleccionar una story y descargarla en MP4 o extraer su audio en MP3 cuando lo tenga.

Se muestran **stories en vídeo**; las fotografías no se convierten. Las stories caducadas, eliminadas o inaccesibles para la sesión utilizada no se pueden recuperar. La selección se mantiene por su identificador, aunque cambie el orden de las stories.

### Conectar Instagram en este equipo

1. Instala una vez el [puente local de Instagram](browser-extension/instagram-bridge/README.md) en Chrome o Edge y recarga Downlink.
2. Abre la aplicación en `http://localhost:3000` en ese mismo navegador.
3. Abre el botón de tres puntos de la esquina superior derecha, entra en **Conectar Instagram** y pulsa **Abrir Instagram**.
4. Completa el inicio de sesión y cualquier verificación en la nueva pestaña de `instagram.com`.
5. Vuelve a la pestaña de Downlink. La conexión se comprobará automáticamente; **Comprobar ahora** queda como alternativa manual.
6. Pega una story, un perfil o `@usuario`. Si ya había un enlace de Instagram en el campo, se vuelve a analizar al conectar.

La cuenta conectada permite intentar la descarga de los vídeos que **esa cuenta pueda ver**, incluidas las stories privadas para las que tenga autorización. No concede acceso a otras cuentas privadas, stories caducadas o contenido retirado. La extracción todavía depende del soporte de yt-dlp y de la respuesta de Instagram; conectar una sesión no garantiza que todos los enlaces funcionen.

Esta conexión está diseñada para **uso local**. No abre el navegador de un visitante remoto: se desactiva fuera de `localhost`, `127.0.0.1` o `::1` y comprueba también el origen y la conexión real. Publicar la web no convierte esta función en un inicio de sesión remoto. La API oficial con Instagram Login está orientada a cuentas profesionales y no ofrece acceso general a stories privadas de terceros. [Documentación oficial de Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

### Duración y desconexión

La conexión dura como máximo **8 horas**, o menos si caduca la sesión de Instagram, y termina al reiniciar el servidor. Para retirarla, abre **Conectar Instagram** desde el menú de tres puntos y pulsa **Desconectar cuenta**. Se elimina su acceso en esta aplicación; esto no equivale a revocar todas las sesiones de la cuenta en Instagram.

La aplicación no recibe tu contraseña ni tus códigos de verificación. El puente solo lee las cookies de `instagram.com` al volver a Downlink durante una conexión iniciada y las entrega al servidor local mediante un token temporal. Downlink conserva esa sesión únicamente en memoria; para cada extracción crea un archivo temporal independiente y lo elimina al terminar. No guarda capturas ni grabaciones del inicio de sesión.

Cada navegador tiene su propia conexión. Los resultados autenticados no entran en la caché compartida; los trabajos y archivos quedan vinculados a su conexión. Al desconectar, se interrumpen las descargas de esa conexión y se eliminan sus archivos. Las pestañas sincronizan cambios de cuenta y caducidad sin transmitirse credenciales.

El servidor web ya no aplica `INSTAGRAM_COOKIES_FILE` globalmente: una cuenta del servidor no debe compartirse con todos los visitantes. Utiliza el botón de conexión de cada navegador.

Referencias: [cookies de yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp) y [extractor de Instagram](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/instagram.py#L648-L706).

## Pruebas

```powershell
npm test
npm run test:ios
npm run test:ios-embedded
```

Las pruebas de stories y conexión usan datos simulados y no necesitan una cuenta de Instagram. Cubren sesión, confirmación explícita, CSRF, origen local, separación de cuentas, descargas privadas, caducidad y limpieza. Una descarga real requiere iniciar sesión manualmente y disponer de acceso al contenido.
