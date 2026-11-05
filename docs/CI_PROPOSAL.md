# Continuous integration

The workflow is now implemented locally in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), following the owner's approval. It will run after the changes are published to GitHub and Actions is available for the repository. No push, remote run, branch-protection setting or release automation has been performed here.

This file retains its original proposal filename so existing links remain valid.

## Implemented checks

| Job | Runner | Checks |
| --- | --- | --- |
| `node-tests` | Ubuntu 24.04 and Windows latest, Node.js 22 | `npm ci`, `npm test`; `npm audit --audit-level=moderate` on Ubuntu |
| `ios-python` | Ubuntu 24.04, Node.js 22, Python 3.14 | `npm ci`, install pinned `yt-dlp==2026.8.19`, `npm run test:ios` |
| `browser-tests` | Ubuntu 24.04, Node.js 22 | Install Chromium/WebKit and system dependencies, set `CHROME_PATH`, run `npm run test:ios-embedded` |

The workflow triggers on pushes to `main`, pull requests and manual dispatch. It uses read-only repository permissions, does not persist checkout credentials and pins actions to full commit SHAs resolved from official repositories. It needs no application account, signing key or deployment secret.

There are no automatic test retries or `continue-on-error` settings. The audit step fails for moderate-or-higher findings. New advisories can therefore require review even when application code has not changed.

## Local validation and browser synchronization

Local validation used Windows, Node.js 22.17.1, Python 3.14.2, Chrome and Playwright WebKit. The full browser suite passed twice consecutively after synchronization. The YAML and its job/trigger/permission structure were parsed locally, and actionlint 1.7.12 passed after the official archive's checksum was verified. GitHub-hosted Linux/Windows execution still needs its first remote run reviewed.

The initial browser test could sample the quality spotlight while the results panel was entering and the real pointer could leave the moving grid. The test now waits for finite panel animations to finish and hovers a real pointer over the first quality option before dispatching the measured event burst. The original geometry-read and visible-interaction assertions remain intact. No application UI code, fixed sleep, retry or ignored failure was introduced.

See [VALIDATION.md](VALIDATION.md) for exact results and historical failures. This synchronization addresses the observed test preconditions; it is not a guarantee that future browser runs can never fail.

## Android stage after toolchain verification

Android is not added as a validated CI job yet. Use a JDK 17 runner, Android SDK platform 36 and build tools 36.0.0. From `android/`:

```sh
./gradlew --console=plain :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

Use debug signing for contributor CI. The default `scripts/build-android.sh` path creates persistent personal signing material and should not be used for untrusted pull requests.

Add an emulator job for the existing **11** instrumentation tests after verifying runtime/image compatibility and runner requirements. A booted x86_64 emulator can be passed to `./scripts/test-android.sh emulator-5554`; the helper installs the app and test APK. Its fixture tests need no platform accounts. Keep `DOWNLINK_LIVE_URL` unset in normal pull-request CI.

Android builds download Maven/Google dependencies and a checksum-verified yt-dlp release. The local audit could not verify this stage without an SDK.

## Native iOS stage after a Mac build

Native iOS compilation is not configured as a validated CI job yet. On a macOS runner with the required full Xcode version:

```sh
cd ios
./Scripts/bootstrap.sh
./Scripts/verify.sh
```

This downloads/prepares native dependencies and performs an unsigned `build-for-testing`. It does not execute XCTest, verify the Python/FFmpeg integration on an iPhone or establish store readiness. Add explicit native test execution after validating architecture/runtime support on a Mac. Signing and store uploads belong in a separately reviewed release process.

## After publication

Review the first remote runs, then decide which checks to require in branch protection. The workflow uses `pull_request`; it does not check out untrusted code in a privileged `pull_request_target` job.

The configuration follows [GitHub's secure workflow guidance](https://docs.github.com/en/actions/reference/security/secure-use). Keep action pins, runner compatibility and dependency advisories under review. Automated tests do not publish releases.
