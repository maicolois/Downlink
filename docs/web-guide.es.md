# Downlink web: guía técnica

Esta guía conserva las instrucciones técnicas detalladas del README original. Para instalación, comparación de plataformas y resultados actuales, consulta [README.es.md](../README.es.md) y el [informe de validación](VALIDATION.md).

## Alias de importaciones

Las importaciones JavaScript internas usan `@/` como alias de la raíz del repositorio, por ejemplo `@/shared/platform-patterns.js`. Los comandos de `package.json` registran el alias en Node; la web utiliza el `importmap` de `public/index.html`, y `jsconfig.json` proporciona resolución y autocompletado al editor. Ejecuta el servidor y las pruebas mediante los comandos `npm`, no mediante `node server/index.js` directamente.

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

1. Instala una vez el [puente local de Instagram](../browser-extension/instagram-bridge/README.md) en Chrome o Edge y recarga Downlink.
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
