# Downlink 1.0.1 validation — 11 September 2026

## Delivered update

Version 1.0.1 (version code 2) adds an automatic image preview after pasting or sharing a link, plus thumbnails in the download queue and library. History images are saved privately on the device for offline use. Existing saved videos without thumbnail metadata use a frame from their local file. Missing images do not fail a media download.

- Phone APK: `artifacts/Downlink-1.0.1-arm64-v8a.apk`, **62,222,547 bytes (59.3 MiB)**.
- SHA-256: `14e024086ef1d513b161d19e4af67aa14a90d60bd01d54a2f2e8c9b551befd02`.
- Emulator APK SHA-256: `89efdb3f1661962840628434565551f71e4583cec065e616b170ff427689152d`.
- Application ID remains `app.downlink.android`; minimum Android 10 / API 29; target SDK 36.
- Personal release signature verified; non-debuggable; ARM64 ABI; ZIP alignment verified.
- Signing certificate SHA-256 remains `34dcc2a3488c32d72c11c701968f3c9243c9e7148d5dc9af074b3e8c1a074307`.
- Identical phone APK copied to `C:\Users\pazpe\Downloads\Downlink-1.0.1-arm64-v8a.apk`.

Install this APK over 1.0.0 using **Update / Actualizar**. Do not uninstall the existing app; updating retains its history, preferences and downloaded files.

## Executed checks

| Check | Result |
| --- | --- |
| Android unit tests | **7 passed** |
| Instrumentation tests, Android 16 / API 36 x86_64 emulator, signed release | **11 passed**, 52.618 seconds on final run |
| Release lint | **0 errors**, 30 advisory warnings |
| Install 1.0.1 over the existing signed 1.0.0 emulator installation | **Passed**; previous history retained; older saved video displayed a frame thumbnail |
| Automatically inspect a real shared Instagram link and display its image | **Passed** |
| Automatically inspect a real shared YouTube link and display its image | **Passed** |
| Download the Instagram video through the UI, restart the app with Wi-Fi and mobile data disabled, display its history thumbnail | **Passed**; Android reported no active default network |
| Installed/tested x86_64 APK compared with packaged artifact | **Identical SHA-256** |
| ARM64 signature, ABI, version and Windows copy verification | **Passed** |

The eight original instrumentation cases still cover real MP4/MP3 output, WebM conversion, background downloads, cancellation and queue continuation, storage recovery, activity recreation and synthetic Instagram session handling. Three additional cases cover:

1. Press **Pegar** using the real Android clipboard, wait for automatic metadata/image loading without pressing Analyze, recreate the activity, and clear the old image when the input changes.
2. Download MP3 without passing pre-analyzed metadata, capture the title and thumbnail from the download, round-trip its persisted JSON, stop the fixture HTTP server, clear bitmap memory, and display the history image across activity recreation using the saved JPEG.
3. Restore a legacy history record without the thumbnail field, generate a preview from its saved MediaStore video, and handle a remote image returning HTTP 404 by falling back to the video frame.

The first clipboard test attempt raced Android's window-focus requirement. The test now waits for focus before reading the clipboard; both subsequent full runs passed. No downloader, image fetcher, transcoder or Android storage component is mocked.

## Real-site and screenshot evidence

- Instagram: `https://www.instagram.com/reel/Chunk8-jurw/`; preview visible and saved video decoded successfully with FFmpeg: H.264, 472 × 840, 4.97 seconds, 63,867 bytes, no audio track. The app correctly rejects MP3 for this silent source.
- YouTube: `https://www.youtube.com/watch?v=jNQXAC9IVRw`; automatic image, title **Me at the zoo**, uploader and duration displayed.
- Screenshots: `artifacts/emulator/instagram-preview-1.0.1.png`, `youtube-preview-1.0.1.png`, and `history-offline-1.0.1.png`.
- Raw suite output: `artifacts/emulator/tests-1.0.1-api36-release.txt`.
- Signature/alignment output: `artifacts/emulator/signature-arm64-1.0.1.txt` and `alignment-arm64-1.0.1.txt`.
- Saved Instagram video decoding: `artifacts/emulator/instagram-media-1.0.1.txt`.

## Reproduce and limits

Run `./scripts/build-android.sh` and `./scripts/test-android.sh emulator-5556 release` with the retained personal signing configuration and a running emulator. The initial Android port's broader platform tests are recorded separately in [TEST_REPORT.md](TEST_REPORT.md).

This update was tested on the emulator; it has not yet been tested on the owner's physical POCO. Some sites omit thumbnails or make them unavailable. Old audio history entries without embedded artwork or a recorded image URL show **Sin vista previa**. Automatic metadata analysis waits while a download queue is active. Private Instagram content and personal login were not used for these tests.
