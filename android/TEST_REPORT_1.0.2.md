# Downlink 1.0.2 validation — 11 September 2026

## Change

Portrait and landscape images keep their proportions in both the link preview and history. The large preview follows the image's aspect ratio, with a maximum height of 280 dp. History uses fit-to-center scaling in its compact slot, showing the full image with background space where needed. The existing thumbnail cache remains compatible.

## Package

- App: `app.downlink.android`, version **1.0.2**, version code **3**.
- Phone APK: `artifacts/Downlink-1.0.2-arm64-v8a.apk`, **62,223,335 bytes**.
- Phone SHA-256: `5072bd3bb6337d299e6c0f443b0104bf0bde3234f5cfd1bc5b559e0dc42d6de6`.
- Emulator SHA-256: `f66cbe6acf8e98ecc1083f68dcbe1512a7d8a908eff016e06b6572c18fbea5bf`.
- Signature and 16 KiB ZIP alignment verification passed.
- Signing certificate remains `34dcc2a3488c32d72c11c701968f3c9243c9e7148d5dc9af074b3e8c1a074307`.
- Matching phone APK copied to `C:\Users\pazpe\Downloads\Downlink-1.0.2-arm64-v8a.apk`.

Open the APK on the phone and choose **Update / Actualizar**. Keep the existing app installed to retain history and preferences.

## Checks executed

| Check | Result |
| --- | --- |
| Android unit tests | **7 passed** |
| Existing instrumentation suite, Android 16 / API 36 x86_64 emulator, signed release | **11 passed**, 50.752 seconds |
| Release lint | **0 errors**, 30 advisory warnings |
| Upgrade existing 1.0.1 emulator installation | **Passed**, history retained |
| Compare installed/tested APK with packaged x86_64 APK | **Identical SHA-256** |
| Real portrait Instagram preview | **Passed**, full image and proportional scaling visually checked |
| Real landscape YouTube preview | **Passed**, image follows available width and retains proportions |
| History with portrait and landscape entries together | **Passed**, both complete images visible |
| Download Instagram and YouTube MP4 through the UI | **Passed**, completed files listed in history |

Screenshots are in `artifacts/emulator/`: `portrait-preview-1.0.2.png`, `landscape-preview-1.0.2.png`, `portrait-history-1.0.2.png` and `mixed-history-1.0.2.png`. The portrait history screenshot also includes the landscape 16:9 test pattern.

Raw suite results: `artifacts/emulator/tests-1.0.2-api36-release.txt`. Signature and alignment results: `signature-arm64-1.0.2.txt` and `alignment-arm64-1.0.2.txt` in the same directory.

Run `./scripts/build-android.sh` and `./scripts/test-android.sh emulator-5556 release` with the retained signing configuration to reproduce the build and suite. This update was checked in the emulator; the owner still needs to install it on the physical POCO. Earlier thumbnail behavior and cache tests are described in [TEST_REPORT_1.0.1.md](TEST_REPORT_1.0.1.md).
