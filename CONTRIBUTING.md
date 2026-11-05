# Contributing to Downlink

Start with the [version comparison](README.md#choose-a-version) and choose the implementation you want to work on. Issues and pull requests may be written in English or Spanish.

## Before you start

For a bug, include the affected platform, operating system, runtime/app version, steps to reproduce, expected behavior and actual behavior. Redact logs and use a public or synthetic example you have permission to share. Never attach cookies, account sessions, private media URLs or signing material.

For a larger change, open an issue describing the problem and proposed scope before implementation. Small documentation corrections can go directly to a pull request. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Local web setup

```sh
git clone https://github.com/YOUR-USERNAME/Downlink.git
cd Downlink
npm ci
npm run dev
```

Use your fork URL above; the upstream repository is [maicolois/Downlink](https://github.com/maicolois/Downlink). Node.js 22 is the tested runtime family. Open http://localhost:3000.

Use the npm scripts rather than invoking the server directly: the scripts register the `@/` import alias. Keep shared URL patterns and quality definitions in `shared/`; keep browser code, server providers and platform-specific behavior in their existing directories.

## Choose checks that cover your change

| Area | Checks | Prerequisites |
| --- | --- | --- |
| Shared JavaScript, server, web or documentation examples | `npm test` | `npm ci` |
| PWA or shared browser UI | `npm run test:ios-embedded`, plus `npm test` | Chrome or `CHROME_PATH`; `node node_modules/playwright-core/cli.js install webkit` |
| Native iOS Python engine | `npm run test:ios` | Python 3; pinned yt-dlp for all ten tests |
| Android | Unit tests, debug build and lint; instrumentation for runtime/UI changes | JDK 17, SDK platform 36, build tools; [Android guide](android/README.md) |
| Native iOS Swift/build integration | `cd ios && ./Scripts/bootstrap.sh && ./Scripts/verify.sh` | macOS, full Xcode and the [iOS guide](ios/README.md) |

The Python runner does not compile Swift or exercise an iPhone. Without yt-dlp it reports two skipped tests. Use an isolated Python environment with `yt-dlp==2026.8.19`; on Windows the script chooses `py -3` first, so verify that interpreter can import it.

For Android, from `android/`, the unsigned/debug contributor path is:

```sh
./gradlew --console=plain :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

On Windows use `.\gradlew.bat` in that directory. The audit attempted the unit-test and lint tasks, which were blocked by the missing SDK; the debug build was not run. Historical results are not a guarantee for your environment. The personal release script creates persistent signing material, so use debug builds for routine contributions. Follow [the emulator guide](android/README.md#emulator-tests) for instrumentation.

The iOS verification script runs Python tests and builds the app/test bundle for testing; it does **not** execute the Swift XCTest suite. Run those tests on a configured Apple device/simulator as a separate validation step.

Check the [latest recorded validation](docs/VALIDATION.md) before reporting failures. It records an intermittent browser assertion as well as missing-toolchain limitations. Include the exact failing command; do not silently skip failures.

## Working conventions

- Keep changes focused and preserve the Spanish interface unless localization is part of the issue.
- Follow the surrounding style. Use `@/` for internal JavaScript imports; update shared definitions rather than duplicating them.
- Add or adjust regression tests when behavior changes. Use synthetic fixtures; live-site checks are optional and must not require shared credentials.
- Update the English README and its Spanish translation together when scope, setup or status changes. Keep detailed platform instructions and link to them.
- For screenshots, use the actual application, identify the browser/device and fixture data, and follow [the provenance notes](docs/screenshots/README.md).
- Keep generated binaries, downloads, SDKs, credentials and local configuration out of Git. Review `git diff` and `git status --short` before submitting.

## Pull request description

Explain the user-visible problem and resulting behavior, then list the checks you ran and their results. State skipped checks and why they were unavailable. For a UI change, include an actual screenshot with sensitive information removed before capture.

Do not mix dependency upgrades, formatting, platform ports and unrelated fixes into one change. Discuss API changes, release automation and licensing separately. The [CI workflow](.github/workflows/ci.yml) runs Node, Python, browser and dependency checks when published to GitHub; [the CI guide](docs/CI_PROPOSAL.md) records its scope. Branch-protection requirements and remote runner results have not been configured or verified here.

## Licensing

First-party Downlink code uses [GPL-3.0-only](LICENSE). Android's existing terms and all third-party licenses/notices remain in place. Read [the current status](README.md#licensing-status) and preserve component notices when adding or updating dependencies.

License changes and third-party redistribution notices require maintainer review. This guide introduces no CLA or DCO requirement.
