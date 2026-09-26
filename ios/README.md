# Downlink para iOS · iPhone y iPad

La versión iOS es la misma web de escritorio instalada desde Safari. Comparte HTML, estilos, fondos, tipografías, perfiles y controles; usa las reglas adaptables que ya tenía el proyecto. No requiere publicar Downlink en la App Store, compilar una aplicación nativa ni pagar una membresía de Apple.

El iPhone muestra la interfaz. El ordenador ejecuta Node, yt-dlp y FFmpeg y prepara los archivos. Debe permanecer encendido, conectado y sin suspenderse mientras lo utilizas. No es la versión Android autónoma.

## Organización

Todo lo específico de la PWA se mantiene dentro de `ios/`:

```text
ios/
  public/
    assets/icons/        # Iconos de instalación para iPhone/iPad
    css/pwa.css          # Ajustes de pantalla e instalación
    js/pwa.js            # Instalación y estado de conexión
    js/download-session.js  # Recuperación de descargas
    manifest.webmanifest
    sw.js                # Inicio sin conexión
  scripts/               # Generación de iconos y pruebas de navegador
  tests/                 # Pruebas de recuperación de descargas
  server.js              # Integración de los recursos con el servidor común
  README.md
```

La página, el diseño y la lógica de conversión comunes siguen en `../public/`, `../shared/` y `../server/`. Una modificación del diseño compartido se aplica tanto a desktop como a iOS. Esta carpeta contiene una PWA, no un proyecto de Xcode.

El servidor sirve `ios/public/` en la misma raíz web que `public/`: las direcciones `/sw.js`, `/manifest.webmanifest`, `/css/pwa.css` y `/js/pwa.js` se conservan. Esto mantiene el alcance del service worker, las instalaciones existentes y las referencias de la interfaz. No se publica la documentación ni los scripts de desarrollo.

## Arrancar

Desde la raíz del repositorio (un nivel por encima de `ios/`):

```powershell
npm install
npm start
```

En el ordenador se abre en `http://localhost:3000`.

Para una primera comprobación desde un iPhone en la misma Wi-Fi, abre `http://IP-DEL-ORDENADOR:3000` en Safari. Puedes consultar la IPv4 del adaptador Wi-Fi con `ipconfig`. La conexión depende también del cortafuegos del equipo. `localhost` en el teléfono apunta al propio teléfono.

En una dirección HTTP de la red local puedes utilizar la web y pegar manualmente los enlaces. Para disponer de inicio sin conexión y de las funciones web que requieren un contexto seguro, utiliza una dirección **HTTPS con certificado válido y confiable para el iPhone**. Aceptar un aviso de certificado no sustituye este requisito.

## HTTPS privado con el ordenador existente

Una opción es Tailscale Serve. Requiere instalar Tailscale en el ordenador y en el iPhone, iniciar sesión y conectar ambos a la misma red privada de Tailscale. Después de arrancar Downlink, ejecuta en otra terminal del ordenador:

```powershell
tailscale serve --bg http://127.0.0.1:3000
tailscale serve status
```

Si Tailscale solicita habilitar HTTPS, completa su configuración. Abre en Safari la dirección `https://…ts.net` que devuelve el comando. Serve proporciona HTTPS dentro de tu red de Tailscale; mantén conectada la aplicación de Tailscale en el iPhone. No hace falta contratar alojamiento para esta configuración. [Documentación de Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).

Si ya tienes un servidor con dominio y HTTPS, puedes poner un proxy inverso delante del puerto 3000. Sirve la aplicación en la raíz del dominio; la interfaz y `/api` deben compartir origen. El alojamiento tiene que poder ejecutar Node y los conversores, además de almacenar temporalmente los archivos. Si lo expones fuera de una red privada, configura autenticación y límites de consumo; los perfiles locales no protegen el acceso al servidor.

Esta implementación no publica el proyecto ni configura cuentas, DNS, certificados o redes externas automáticamente.

## Instalar en el iPhone

1. Abre la dirección HTTPS de Downlink en **Safari**.
2. Pulsa **Compartir → Añadir a pantalla de inicio**.
3. Activa **Abrir como app web**, si aparece, y pulsa **Añadir**.
4. Abre el icono de Downlink desde la pantalla de inicio y crea tu perfil si te lo pide. La instalación puede tener almacenamiento separado del navegador.

El menú del avatar también incluye estas instrucciones en iPhone y iPad cuando la web no está instalada. [Guía de Apple](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios).

## Descargar y reabrir

- Pega un enlace, selecciona MP4 o MP3 y la calidad, y pulsa **Descargar**.
- Cuando el servidor termine, el mismo botón cambia a **Guardar MP4/MP3**. Púlsalo para entregar el archivo a Safari; según el archivo y la versión de iOS, utiliza Descargas o Compartir → Guardar en Archivos. El mensaje indica que se ha iniciado la entrega, no que iOS ya haya guardado el archivo.
- Si cierras la web después de que el servidor haya devuelto el identificador de trabajo, la próxima apertura recupera ese trabajo para el mismo perfil local. No comienza otra conversión.
- Si se pierde la conexión, aparece **Retomar descarga**. Al recuperar la conexión o volver a la app se vuelve a consultar el trabajo.
- El servidor puede seguir convirtiendo mientras iOS suspende la interfaz. El guardado en el teléfono necesita una acción tuya.
- Los trabajos son temporales, con una ventana de recuperación de hasta cuatro horas. Reiniciar el servidor pierde los trabajos en memoria. La aplicación explica cuándo un archivo ya no está disponible.
- Las sesiones privadas de Instagram mantienen su caducidad y eliminación al desconectar. El inicio de sesión de Instagram sigue limitado al ordenador: no se ha convertido en un acceso remoto desde el iPhone.

La caché sin conexión incluye exclusivamente archivos públicos de la interfaz. No incluye API, sesiones, vídeos, audios ni miniaturas remotas. Sin Internet podrás abrir la interfaz ya visitada, pero no analizar enlaces, convertir ni recuperar archivos del servidor.

## Desarrollo y validación

```powershell
npm test
node node_modules/playwright-core/cli.js install webkit
npm run test:ios
```

Las pruebas de navegador requieren Google Chrome instalado, o su ruta en `CHROME_PATH`, y el WebKit de Playwright. Utilizan la interfaz y el service worker reales con una API de prueba y contenido sintético; no descargan contenido de plataformas ni utilizan cuentas personales. Comprueban tamaños móviles, instrucciones de instalación, MP4/MP3, guardado, cancelación, recuperación tras recarga y desconexión, caducidad y exclusión de la API de la caché. Las capturas se generan en `artifacts/ios/`, en la raíz del repositorio.

WebKit automatizado no sustituye una prueba en un iPhone físico: quedan por comprobar en el dispositivo la instalación desde Safari, los permisos del portapapeles y el guardado mediante las ventanas de iOS.

Los iconos se generan desde el favicon SVG compartido mediante `npm run icons:ios`. Cuando cambie la interfaz, incrementa la versión de caché en `ios/public/sw.js`; el nuevo worker se activa al cerrar las ventanas anteriores, sin recargar una descarga en curso. Los comandos anteriores `test:pwa` e `icons:pwa` siguen disponibles como alias.
