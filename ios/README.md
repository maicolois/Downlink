# DOWNLINK para iOS

Aplicación nativa SwiftUI que replica el diseño de la web y ejecuta las descargas en el propio iPhone. No usa el servidor Node de este repositorio: CPython, `yt-dlp`, el motor JavaScript de WebKit y FFmpeg se integran dentro de la aplicación.

## Preparación en el Mac

Requisitos: macOS, Xcode 26 o posterior completo, sus herramientas de línea de comandos, Python 3 y unos 3 GB libres durante la preparación. Si tienes Homebrew, el script puede instalar Python 3 y XcodeGen cuando falten.

```sh
cd ios
chmod +x Scripts/*.sh
./Scripts/bootstrap.sh
open Downlink.xcodeproj
```

En Xcode, selecciona el target **Downlink**, abre **Signing & Capabilities**, elige tu Apple ID/Team y cambia `app.downlink.ios` si Xcode indica que el identificador ya está ocupado. Después conecta el iPhone, activa el modo desarrollador y pulsa **Run**.

La app guarda los resultados en `En mi iPhone/DOWNLINK/Downloads`, visibles desde Archivos. También permite compartir el archivo al terminar.

Antes de instalarla, puedes ejecutar la comprobación completa en el Mac:

```sh
./Scripts/verify.sh
```

Este comando prueba el motor Python, valida los plist, vuelve a generar el proyecto y compila la app y sus pruebas para un dispositivo iOS sin exigir una firma.

## Arquitectura

- `Downlink/App`: inicio, navegación y ciclo de vida.
- `Downlink/Features`: interfaz SwiftUI y estado de cada flujo.
- `Downlink/Services`: Python, FFmpeg, cookies de Instagram, llavero y archivos.
- `Downlink/Python`: adaptación de `yt-dlp` a iOS y puente hacia FFmpeg.
- `Resources`: tipografía, colores e icono derivados del diseño web actual.
- `Scripts`: preparación reproducible de dependencias y runtime.

Las versiones están fijadas para evitar que una compilación futura cambie sin aviso:

- CPython Apple support `3.13-b15`
- yt-dlp `2026.8.19`
- yt-dlp-ejs `0.8.0`
- yt-dlp-apple-webkit-jsi `0.1.1`
- SwiftFFmpeg-iOS `1.1.0`

`Scripts/bootstrap.sh` comprueba SHA-256 de los binarios descargados antes de usarlos.

## Límites reales de iOS

No depender de un servidor no significa no usar Internet: el iPhone se conecta directamente a YouTube, Instagram, TikTok, X, Reddit o Twitch. Mantén la app abierta durante descargas largas; iOS puede suspender trabajo intensivo si la mandas al fondo. Si fuerzas el cierre, una descarga activa se cancela.

Con un Apple ID gratuito, una app instalada manualmente suele requerir volver a firmarse periódicamente. Una membresía Apple Developer evita esa limitación corta y permite distribuir por TestFlight o App Store.

Descarga únicamente contenido propio o para el que tengas autorización, respetando derechos de autor y las condiciones de cada servicio.

## Licencias

La versión fijada de `SwiftFFmpeg-iOS` se distribuye bajo GPLv3. Para uso personal esto no impide compilarla e instalarla en tu dispositivo. Si más adelante distribuyes la app a terceros, tendrás que cumplir la GPLv3 y las licencias de los códecs incluidos, o sustituir ese paquete por una compilación de FFmpeg con una licencia compatible con tu forma de distribución.
