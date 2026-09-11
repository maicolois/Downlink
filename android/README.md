# Downlink for Android

A standalone Android adaptation of the downloader in this repository, built for the POCO X7 Pro (ARM64) and Android 10 or newer. The interface follows the original app's Spanish language. Extraction and conversion run on the phone; there is no Node server, hosted API, subscription, or computer required after installation.

## Install on your POCO X7 Pro

1. Get **`artifacts/Downlink-1.0.2-arm64-v8a.apk`** from this checkout. Use the ARM64 file for the phone; the x86_64 file is for the emulator.
2. Connect the phone to your PC with USB, choose **File transfer**, and copy the APK into the phone's **Download** folder. Alternatively, transfer the APK using your usual file-transfer method.
3. Open **Files / File Manager → Downloads** on the phone and tap the APK.
4. If Android blocks this first installation, open the **Settings** button in that prompt and enable **Allow from this source** for the file manager you are using. Return to the installer and tap **Install**. You can switch that permission off afterwards. If the menu differs, search Settings for **Install unknown apps**. [Xiaomi's installation instructions](https://www.mi.com/global/support/faq/details/KA-06974/).
5. Open **Downlink**. On the first download, allow **notifications** so progress and the Cancel action are visible.
6. If HyperOS interrupts downloads while the screen is off, open **Downlink → Ajustes → Ajustes de Android**, then the app's **Battery / Battery saver** settings and choose **No restrictions / Sin restricciones**. Menu names vary by HyperOS version.
7. Paste a link and its preview loads automatically. Choose **Vídeo · MP4** or **Audio · MP3**, choose a quality, and tap **Descargar**. You can also use **Share → Downlink** from YouTube, Instagram, TikTok, or a browser. **Analizar** lets you retry metadata loading.

**Updating from 1.0.0 or 1.0.1:** open the new APK and accept **Update / Actualizar**. Do not uninstall the current app. Version 1.0.2 uses the same personal signing key and preserves your history, settings and downloaded files. A copy of the new phone APK is in `C:\Users\pazpe\Downloads` on this workstation.

Completed files are in **Internal storage / Download / Downlink** and the app's **Biblioteca**. **Abrir** plays a file using an installed player; **Compartir** shares the actual file. Removing an item from the app's history leaves its saved file in Downloads.

On this workstation, the checkout is accessible from Windows Explorer at:

```text
\\wsl.localhost\Ubuntu\home\pazpe\DownlinkAndroid\artifacts
```

You do **not** need root access, an unlocked bootloader, Android Studio on the phone, or USB debugging for installation through File Manager.

### Optional installation with ADB

If you already use Android platform-tools, enable Developer options and USB debugging on the phone, connect it by USB, accept the phone's authorization prompt, then run:

```sh
adb devices
adb -s PHONE_SERIAL install -r artifacts/Downlink-1.0.2-arm64-v8a.apk
```

Use the phone's serial from `adb devices`. ADB inside WSL requires the USB device to be forwarded into WSL; using Windows platform-tools or the File Manager method avoids that extra setup.

## Features and scope

| Desktop function | Android adaptation |
| --- | --- |
| YouTube, Instagram, TikTok, X, Reddit, Twitch links | Bundled yt-dlp extractors, plus other supported public HTTP(S) media |
| MP4 video and MP3 audio | On-device FFmpeg conversion; original resolution and bitrate choices |
| Metadata | Automatic image preview, title, uploader, duration, live/silent video checks, collection selection |
| History thumbnails | Locally saved images for offline use; frame extraction for older saved videos |
| Instagram stories / `@username` / profile / highlights | Optional encrypted Instagram session; selection uses video identity so reordering does not select another story |
| Download progress | Foreground notification, queue, cancellation, error details and retry |
| Downloaded files | Android MediaStore in `Download/Downlink`, with open and share actions |
| Local profiles and desktop login browser | Native device preferences and an isolated Instagram login WebView |
| Extractor maintenance | **Ajustes → Buscar actualizaciones**, using the official yt-dlp stable channel |

One selected item downloads at a time. Live broadcasts are rejected; finished recordings can be attempted. Unsupported, removed, expired, restricted, or region-limited content may fail. The app does not recover inaccessible content. A site may require login or change its extractor behavior; update the engine first when previously working links stop working.

MP3 conversion cannot add quality or audio that the source does not contain. Video quality is bounded by the selected resolution, including portrait videos, when the source reports dimensions; direct files with unknown dimensions retain their source dimensions. If no matching quality exists, choose **Mejor disponible**. MP4 conversion can take longer for sources that need transcoding.

Preview loading starts shortly after pasting, typing or sharing a valid link. While downloads are active, automatic analysis waits until the queue finishes. History thumbnails are stored privately on the phone, including for new MP3 downloads, and remain available offline. Older video entries obtain an image from the saved video; older audio entries without artwork or a recorded thumbnail URL may show **Sin vista previa**. A missing image does not prevent downloading. Removing a history entry also removes its cached history image.

Portrait and landscape thumbnails retain their proportions and show the complete image in both places. The large preview adjusts its height, capped at 280 dp for tall images. Compact history thumbnails fit inside their slot; unused space uses the app's background color.

### Instagram connection

Open **Ajustes → Conectar Instagram**, log in directly on `instagram.com`, and tap **Ya he iniciado sesión**. Downlink only activates the session after that confirmation. It encrypts the selected Instagram cookies using Android Keystore, excludes them from backup, and limits the connection to eight hours. Cookies are only supplied to Instagram extractions through a temporary app-private file, which is removed afterwards. The login WebView disables screenshots and file access, and clears its browsing data when closed.

**Desconectar cuenta** removes the app's session and cancels associated unfinished downloads. Files you already chose to save stay in Downloads. Disconnecting does not revoke sessions in other apps. Some Instagram accounts may reject login in a WebView or require further verification; successful login and private-story access require your own manual check on the phone. No personal account credentials were used in automated tests.

### Background behavior and storage

Normal backgrounding and activity recreation keep the download service running. Android force-stop, a reboot, or system termination interrupts current work; on reopening the app, unfinished work is marked interrupted and can be retried. Temporary files and unfinished MediaStore entries are cleaned up. Jobs are not automatically resumed after force-stop or reboot.

No broad storage permission is requested. Keep free space for the bundled runtime and both the temporary download and the final copy while it is being saved. Android imposes time limits on background data-sync services, and HyperOS can impose additional battery restrictions.

## Build

Prerequisites: JDK 17, Android SDK command-line tools, platform 36 and build-tools, Python 3 (only to create the local signing configuration/package the output), and network access for the first build. Node/npm are only needed for the original desktop app and its tests.

Install SDK components using [Google's command-line tools](https://developer.android.com/studio#command-tools):

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export JAVA_HOME=/path/to/jdk-17
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
sdkmanager --licenses
sdkmanager 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
./scripts/build-android.sh
```

The script creates a personal release signing key on the first run, builds both ABIs, runs the seven Android unit tests and release lint, and copies APKs plus SHA-256 checksums to `artifacts/`. The release APK is signed and is not debuggable. For a debug build, use `./scripts/build-android.sh debug`.

**Keep `android/.signing/downlink-personal.jks` and `android/signing.properties` backed up privately.** Future updates must use the same key. Both are ignored by Git; losing them prevents installing an update over this build. Installing a release over a separately signed debug installation also requires uninstalling the debug app first, which removes its app-private data.

You can open `android/` directly in Android Studio. Build configuration pins AGP, Kotlin, the Gradle distribution checksum, the Android runtime wrapper, and the bundled yt-dlp release/checksum. See [THIRD_PARTY.md](THIRD_PARTY.md) for licenses and source references.

## Emulator tests

Install an image and create an emulator (Linux with working KVM is recommended):

```sh
sdkmanager 'emulator' 'system-images;android-35;google_apis;x86_64'
avdmanager create avd -n Downlink_API_35 \
  -k 'system-images;android-35;google_apis;x86_64' --device pixel_7
emulator -avd Downlink_API_35 -gpu swiftshader
# In another terminal, after Android has booted:
./scripts/test-android.sh emulator-5554
```

The eleven instrumentation tests run real yt-dlp, Python, QuickJS and FFmpeg inside the emulator. An HTTP fixture serves original synthetic media and a page with a thumbnail for reproducible MP4, MP3, WebM conversion, foreground/background, queue/cancel, storage recovery, sharing/recreation, session, automatic preview and offline history tests. No downloader or transcoder is mocked.

To test the signed release itself on a fresh emulator, run `./scripts/test-android.sh emulator-5556 release` after building the release. The test APK is signed with the same personal key. A debug app already installed on that emulator must be uninstalled before installing the differently signed release.

Optional public-site smoke test:

```sh
DOWNLINK_LIVE_URL='https://www.youtube.com/watch?v=jNQXAC9IVRw' \
  ./scripts/test-android.sh emulator-5554
```

Site tests depend on the site's current availability and your network. The script explicitly accepts emulator serials only. Reports are saved under `artifacts/emulator/`; Gradle unit/lint reports are under `android/app/build/reports/`. See [TEST_REPORT_1.0.2.md](TEST_REPORT_1.0.2.md) for this update's validation, [TEST_REPORT_1.0.1.md](TEST_REPORT_1.0.1.md) for the thumbnail feature, and [TEST_REPORT.md](TEST_REPORT.md) for the original Android port.
