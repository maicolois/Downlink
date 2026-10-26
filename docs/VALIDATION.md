# Validation record — 2026-10-26

Baseline inspected: `f510b07` on `main`. The initial phase changed documentation only. The owner subsequently authorized dependency, local-listener, license, test and CI changes; those follow-up results are listed first below. All changes remain local and uncommitted. Results are observations, not a remote CI badge or a claim of compatibility with every upstream service.

## Follow-up after owner approval

| Command/check | Outcome | Scope |
| --- | --- | --- |
| `npm install 'express@^4.22.3' 'uuid@^14.0.3' --no-fund`, then `npm audit fix --no-fund` | Exit 0 | Explicit direct updates and non-forced transitive patch updates; no overrides. |
| `npm ci --no-fund` | Exit 0; 97 packages installed | Reinstalled from the updated lockfile; no vulnerabilities reported. |
| `npm test` | Exit 0; **124 passed, 0 failed, 0 skipped** | Existing 122 tests plus two real TCP/HTTP server-bind checks. |
| `$env:HOST = '192.0.2.1'; npm test` | Exit 0; **124 passed** | Final Node rerun confirms API fixtures do not inherit a developer's listener address. |
| `npm run test:ios`, with the isolated pinned yt-dlp package directory | Exit 0; **10 passed, 0 skipped** | Python engine/adapter suite; native build remains untested. |
| `npm run test:ios-embedded` after test synchronization, two consecutive complete runs | Exit 0 in both runs | Desktop, Chromium mobile and WebKit mobile checks; production UI and synthetic API. |
| `npm audit --json` after the clean reinstall | Exit 0; **0 vulnerabilities** | All five initial affected dependency entries resolved in the updated lockfile. |
| `actionlint 1.7.12 -no-color .github/workflows/ci.yml` | Exit 0 | Workflow expressions/schema checked with the official Windows binary after verifying its release-archive SHA-256 against official checksums. |

Resolved versions: Express **4.22.3**, body-parser **1.20.9**, proxy-addr **2.0.8**, qs **6.16.1**, uuid **14.0.3**. Existing API tests exercise UUID v4 job creation with the unchanged ESM import. Zero reported advisories describes the npm audit database at this check, not an absence of all possible vulnerabilities.

The server now defaults to `HOST=127.0.0.1`. Tests start the actual server process with a synthetic extractor, confirm a real TCP connection to `127.0.0.1`, reject `127.0.0.2` in default mode, and confirm HTTP succeeds there with explicit `HOST=0.0.0.0`. The wildcard test also checks that Instagram login remains unavailable for that non-allowlisted host. Using an alternate loopback address exercises wildcard binding without requiring a LAN adapter; it is not a physical-iPhone test. Existing API fixtures explicitly bind to loopback so a developer's LAN `HOST` setting cannot redirect their test servers.

The browser test now waits for finite result-panel animations and positions a real pointer before measuring the spotlight burst. Both original assertions (bounded geometry reads and nonzero interaction strength) remain. This addresses moving-layout/pointer preconditions without changing application UI code or suppressing test failures. The original failure history is retained below.

GPL-3.0-only has been added at the root and in package metadata with owner approval; existing Android and third-party license notices remain. The CI workflow is implemented locally, but has not been pushed or executed by GitHub.

## Environment

Windows, PowerShell, Node.js **22.17.1**, npm **10.9.2**, Python **3.14.2** through `py -3`, Java **21.0.10**, Gradle wrapper **8.13**. Chrome was available. Playwright WebKit **2359** was installed through the committed playwright-core package.

No configured Android SDK/ADB/emulator and no macOS/Xcode environment were available.

## Initial audit commands and outcomes

| Command/check | Outcome | Scope |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | Exit 0; 98 packages installed | Lockfile-based dependency installation, including native package installation. npm warned that uuid 10 is deprecated. |
| `npm test` | Exit 0; **122 passed, 0 failed, 0 skipped** | Node tests, fixture-backed API tests and PWA session unit tests. |
| `npm run test:ios`, before optional dependency setup | Exit 0; 10 discovered, **8 passed, 2 skipped** | yt-dlp was initially absent from the selected Python interpreter. |
| `npm run test:ios`, with `yt-dlp==2026.8.19` on `PYTHONPATH` | Exit 0; **10 passed, 0 skipped** | Python engine/adapter logic, including fake native FFmpeg calls; not a real iOS conversion. |
| `node node_modules/playwright-core/cli.js install webkit` | Exit 0 | Installed the missing WebKit browser outside the repository. |
| `npm run test:ios-embedded`, final attempt | Exit 0; desktop, Chromium iPhone-emulation and WebKit iPhone-emulation checks passed | Real browser UI/service worker with synthetic API and test media. |
| `npm start` with `PORT=3189` | Server started; stopped after smoke check | Reused local `bin/yt-dlp.exe`, version `2026.08.19`. |
| HTTP GET `/`, `/manifest.webmanifest`, `/sw.js`, `/shared/platform-patterns.js` | **200** for all four | Startup/static/PWA asset serving; no real-site extraction attempted. |
| From `android/`: `.\gradlew.bat --console=plain :app:testDebugUnitTest :app:lintDebug` | Exit 1, **blocked before tests** | `SDK location not found`; no `ANDROID_HOME` or local SDK configuration. |
| Android instrumentation, physical Android device | Not run | No SDK/emulator/ADB/device configured. |
| iOS `Scripts/bootstrap.sh`, `Scripts/verify.sh`, Swift XCTest and device installation | Not run | Require macOS/Xcode and native dependencies. |
| `npm audit --json` | Nonzero audit result; **5 affected dependency entries** | 1 critical, 1 high, 3 moderate; see [dependency review](AUDIT.md#dependency-review). |

The complete Python rerun used an isolated temporary package directory, leaving the repository's native bundle and the user's global Python packages unchanged:

```powershell
$downlinkAuditPackages = Join-Path ([System.IO.Path]::GetTempPath()) 'downlink-docs-audit-python-20261026'
py -3 -m pip install --disable-pip-version-check --no-deps --target $downlinkAuditPackages 'yt-dlp==2026.8.19'
$env:PYTHONPATH = $downlinkAuditPackages
npm run test:ios
Remove-Item Env:PYTHONPATH
```

This is the exact audit setup. For your own shell, preserve any pre-existing `PYTHONPATH` when adapting it. The temporary dependency directory is not a project artifact.

## Browser failures retained in the record

There were three attempts, without changes to application or test code:

1. The first passed the desktop and Chromium mobile checks, then failed to launch WebKit because its executable had not been installed.
2. After installing WebKit, the second failed in `sharedPerformanceChecks` at `ios-embedded/scripts/test-pwa.mjs:228`: **“The optimized spotlight should remain interactive”**.
3. The final attempt passed the full suite in Chrome and WebKit.

At the initial audit stage, the second failure's cause was not established. The subsequent test change controls the moving result-panel and real-pointer preconditions, and the full suite passes. This does not establish that every possible intermittent failure has been eliminated. The workflow has no unconditional retries or `continue-on-error`.

The passing browser run covered mobile widths, options/Instagram dialogs, MP4/MP3 job flows, reload recovery, offline recovery, saving, expiry, cancellation, cache isolation, desktop layout checks, backdrop rendering and its no-WebGL fallback. The API, account state and conversion jobs were synthetic. No personal Instagram account was used.

## Native test inventory

- Android: **7 JUnit tests** in `DownloadOptionsTest.kt`; **11 instrumentation tests** in `AndroidDownloadTest.kt`; an optional `ExternalSmokeTest` for an explicitly supplied live URL. Counts describe inspected source, not tests rerun here.
- Native iOS: **10 Python tests** and **5 Swift XCTest methods** in `URLInputTests.swift`. Only Python ran here.
- `ios/Scripts/verify.sh` runs Python tests, validates plists, generates the Xcode project and invokes `build-for-testing`. That builds a test bundle; it does not execute XCTest.

Existing [Android 1.0.2](../android/TEST_REPORT_1.0.2.md), [1.0.1](../android/TEST_REPORT_1.0.1.md) and [original port](../android/TEST_REPORT.md) reports are preserved as historical evidence. Their APK hashes, device/emulator claims and counts were not independently reverified.

## What remains unverified

Current downloads from each third-party site, authenticated/private Instagram access, a clean first-run extractor download, complete fresh-machine Android/iOS setup, native iOS compilation, physical-device behavior and release signing/distribution were not tested.

The startup smoke reused existing local tools. Installation from the updated npm lockfile succeeds locally, but this is not proof that all platforms' clean-room installation paths are reproducible. Use the [CI guide](CI_PROPOSAL.md) and [release gates](RELEASE_PLAN.md) to close those gaps.

## Documentation checks

Reviewed 18 Markdown files and checked 100 local file/image targets; no missing targets were found. The two documentation images were visually inspected and their SHA-256 values match the provenance record. The implemented workflow YAML was parsed with PyYAML 6.0.3 in an isolated temporary directory, checking its three jobs, triggers, read-only permissions and full action SHA references; actionlint 1.7.12 also passed. Package and lockfile license/dependency metadata agree, and the root license text matches the retained Android license byte for byte. These checks do not execute GitHub runners.

`git diff --check` passed. Following owner approval, the changes also include the server bind/default log, dependency manifest/lockfile, two connection tests, browser-test synchronization, CI workflow and root license. Native application code, platform build configuration, ignore rules and the existing Android license remain unchanged.
