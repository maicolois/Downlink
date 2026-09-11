# Downlink

Conversor de YouTube, X, Instagram, TikTok, Reddit y Twitch a MP4 y MP3.

```powershell
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Estructura del proyecto

```text
public/
  assets/       # Avatares, iconos y recursos gráficos públicos
  css/          # Estilos de la interfaz
  js/           # Código del navegador, separado por componentes y fondos
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

## Perfiles locales

Al entrar por primera vez, crea un perfil con un nombre, un color o una foto. No usa contraseñas: los perfiles y su avatar se guardan únicamente en el almacenamiento local de ese navegador. Desde el avatar de la esquina superior derecha puedes cambiar de perfil, editarlo, gestionar la conexión de Instagram o salir.

Este selector sirve para personalizar la experiencia en el dispositivo; no es una cuenta remota ni un sistema de autenticación de seguridad.

## Stories de Instagram

En el mismo campo puedes pegar:

- Una story: `https://www.instagram.com/stories/usuario/12345678901234567/`
- Las stories activas: `https://www.instagram.com/stories/usuario/`
- Un perfil: `https://www.instagram.com/usuario/`
- Una colección destacada: `https://www.instagram.com/stories/highlights/12345678901234567/`

También puedes escribir `@usuario` y pulsar Enter. Al pegar, el análisis empieza automáticamente. Las flechas permiten seleccionar una story y descargarla en MP4 o extraer su audio en MP3 cuando lo tenga.

Se muestran **stories en vídeo**; las fotografías no se convierten. Las stories caducadas, eliminadas o inaccesibles para la sesión utilizada no se pueden recuperar. La selección se mantiene por su identificador, aunque cambie el orden de las stories.

### Conectar Instagram en este equipo

1. Abre la aplicación en `http://localhost:3000` en el mismo ordenador donde ejecutas el servidor. Ten instalado Google Chrome o Microsoft Edge.
2. Abre el avatar de la esquina superior derecha, entra en **Cuenta de Instagram** y pulsa **Abrir Instagram**.
3. Completa el inicio de sesión y cualquier verificación directamente en la ventana de `instagram.com`. Esa ventana utiliza una sesión nueva, separada de tu navegador habitual.
4. Vuelve al conversor y pulsa **Ya he iniciado sesión**. Mantén abierta la ventana de Instagram hasta confirmar.
5. Pega una story, un perfil o `@usuario`. Si ya había un enlace de Instagram en el campo, se vuelve a analizar al conectar.

La cuenta conectada permite intentar la descarga de los vídeos que **esa cuenta pueda ver**, incluidas las stories privadas para las que tenga autorización. No concede acceso a otras cuentas privadas, stories caducadas o contenido retirado. La extracción todavía depende del soporte de yt-dlp y de la respuesta de Instagram; conectar una sesión no garantiza que todos los enlaces funcionen.

Esta conexión está diseñada para **uso local**. No abre el navegador de un visitante remoto: se desactiva fuera de `localhost`, `127.0.0.1` o `::1` y comprueba también el origen y la conexión real. Publicar la web no convierte esta función en un inicio de sesión remoto. La API oficial con Instagram Login está orientada a cuentas profesionales y no ofrece acceso general a stories privadas de terceros. [Documentación oficial de Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

### Duración y desconexión

La conexión dura como máximo **8 horas**, o menos si caduca la sesión de Instagram, y termina al reiniciar el servidor. Para retirarla, abre **Cuenta de Instagram** desde el avatar y pulsa **Desconectar cuenta**. Se elimina su acceso en esta aplicación; esto no equivale a revocar todas las sesiones de la cuenta en Instagram.

La aplicación no recibe tu contraseña ni tus códigos de verificación. Tras tu confirmación, conserva en memoria únicamente las cookies de Instagram de la ventana que ha abierto. Para cada extracción crea un archivo temporal independiente y lo elimina al terminar. No importa el perfil habitual ni guarda capturas o grabaciones del inicio de sesión.

Cada navegador tiene su propia conexión. Los resultados autenticados no entran en la caché compartida; los trabajos y archivos quedan vinculados a su conexión. Al desconectar, se interrumpen las descargas de esa conexión y se eliminan sus archivos. Las pestañas sincronizan cambios de cuenta y caducidad sin transmitirse credenciales.

El servidor web ya no aplica `INSTAGRAM_COOKIES_FILE` globalmente: una cuenta del servidor no debe compartirse con todos los visitantes. Utiliza el botón de conexión de cada navegador.

Referencias: [cookies de yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp), [extractor de Instagram](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/instagram.py#L648-L706) y [contextos aislados de Playwright](https://playwright.dev/docs/browser-contexts).

## Pruebas

```powershell
npm test
```

Las pruebas de stories y conexión usan datos simulados y no necesitan una cuenta de Instagram. Cubren sesión, confirmación explícita, CSRF, origen local, separación de cuentas, descargas privadas, caducidad y limpieza. Una descarga real requiere iniciar sesión manualmente y disponer de acceso al contenido.
