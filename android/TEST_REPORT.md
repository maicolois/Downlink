# Android validation — 11 September 2026

## Deliverable

- App: **Downlink 1.0.0**, `app.downlink.android`, version code 1.
- Phone APK: `artifacts/Downlink-1.0.0-arm64-v8a.apk` — **62,205,307 bytes (59.3 MiB)**.
- Minimum Android: **10 / API 29**. Target and compile SDK: **36**.
- Signed personal release; `debuggable=false`. APK signature verification and ZIP alignment checks passed.
- Phone APK SHA-256: `1e5a8d33e74757713ddcf4a3624d7262f3be698c8af1e5cd71f3d52282847917`.
- Signing certificate SHA-256: `34dcc2a3488c32d72c11c701968f3c9243c9e7148d5dc9af074b3e8c1a074307`.
- A matching copy is available at `C:\Users\pazpe\Downloads\Downlink-1.0.0-arm64-v8a.apk`.

The tested x86_64 release APK has SHA-256 `6a6ccea018697e1359f0615e4807bbe905cc146ad3653d70cd183656a7161b89`. Its app source, configuration and bundled extractor match the ARM64 build; its native runtime binaries use the emulator's architecture. The packaged binaries for ARM64 Python, FFmpeg and QuickJS were also checked for ARM64/16 KiB ELF alignment. This does not substitute for physical-phone testing.

## Executed checks

| Check | Environment / build | Result |
| --- | --- | --- |
| Existing desktop regression suite | Node 20, `npm test` | **90 passed** |
| Android unit tests | JDK 17 / Gradle 8.13 | **7 passed** |
| Android instrumentation suite | Android 15 / API 35, x86_64 emulator, debug | **8 passed** |
| Android instrumentation suite | Android 16 / API 36, x86_64 emulator, signed release | **8 passed** |
| Android lint | Debug and release | **0 errors**; non-blocking advisory warnings remain |
| Signed release install, launch and visible UI download | Android 16 emulator | **Passed** |
| Release file saved while app was backgrounded and screen off | Android 16 emulator, real YouTube MP4 | **Passed** |
| APK signature, ABI, minimum SDK and non-debuggable flag | ARM64 release | **Passed** |
| Package hashes | Published local artifacts vs tested build outputs | **Identical** |

The eight instrumentation tests exercise:

1. Bundled yt-dlp initialization/version, metadata extraction, and an MP4 containing video and audio.
2. Real FFmpeg MP3 extraction at 320 kbps, checked with Android's media parser and file size.
3. Actual WebM-to-MP4 conversion, including MP4 container identification and playable audio/video tracks.
4. Incoming Android share text, format/input preservation across activity recreation, and invalid-input feedback.
5. Foreground-service download while the app is in the background, MediaStore publication and playable output.
6. Cancellation during a slow HTTP transfer, partial-file cleanup, then completion of the next queued MP3.
7. Restart recovery using persisted interrupted-job state and pending MediaStore files.
8. Encryption and domain scoping of synthetic Instagram credentials, and disconnection cleanup.

The HTTP fixture serves an original generated test pattern and sine tone **inside the emulator**. yt-dlp, Python, QuickJS, FFmpeg, Android storage and the foreground service are real; they are not mocked. The seven unit tests cover share-link normalization, supported quality options, input rejection, domain scoping and stable story selection.

## Public network downloads

These opt-in checks ran against the real platforms from the Android 15 emulator:

| Source | Output | Result |
| --- | --- | --- |
| YouTube: `jNQXAC9IVRw` (Me at the zoo) | MP4, 744,412 bytes | Passed; playable audio/video |
| Same YouTube video | MP3, 457,388 bytes | Passed; actual audio conversion |
| Instagram: reel `Chunk8-jurw` | MP4, 1,949,801 bytes | Passed; the source is a silent video |
| TikTok: `@patroxofficial/video/6742501081818877190` | MP4, 2,748,647 bytes | Passed; playable media |

The signed release was then tested through its visible UI on Android 16: receive the YouTube link, select MP4, tap Download, background the app and turn the screen off. It saved `Me at the zoo [jNQXAC9IVRw].mp4` in public `Download/Downlink`. Independent FFprobe inspection found **H.264 video, AAC audio, 19.064 seconds**, and **744,412 bytes**. The service stopped after completion, and the file appeared in the app's library.

An older yt-dlp example URL, `BaW_jenozKc`, was unavailable on YouTube and returned a platform error. The public Instagram sample has no audio track; the live test was corrected to validate the tracks reported by the source rather than requiring audio for every MP4. Neither observation was treated as a successful audio download.

## Evidence and reproducibility

- Run `./scripts/test-android.sh emulator-5554` for the debug emulator suite.
- Run `./scripts/test-android.sh emulator-5556 release` for the signed release suite on a fresh emulator.
- Run `./scripts/build-android.sh` to reproduce the signed local artifacts using the retained personal signing key.
- Raw emulator results and network smoke-test output are in `artifacts/emulator/`.
- Screenshots: `artifacts/emulator/home-initial.png` and `artifacts/emulator/release-library-android16.png`.
- Release media inspection: `artifacts/emulator/release-youtube-media.json`.
- Signature verification: `artifacts/emulator/signature-arm64.txt`.
- Gradle unit/lint reports: `android/app/build/reports/`.
- APK checksums: `artifacts/SHA256SUMS-release.txt`.

## Limits of the tests

The POCO X7 Pro itself was not connected, so its particular HyperOS battery behavior and hardware have not been physically tested. Private Instagram stories and real account login need the owner's manual verification; automated session tests use invented credentials. X, Reddit and Twitch extractors are included but were not checked with live network downloads. Site availability, login requirements, regional restrictions and future platform changes can affect individual links.
