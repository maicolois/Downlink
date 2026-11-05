# First tagged prerelease proposal

**Draft only — not published.** No tag, GitHub release, APK/IPA upload or version bump has been created.

## Proposed identity and scope

Suggested tag: **`v1.2.0-rc.1`**. Suggested title: **Downlink 1.2.0 RC1 — Web/PWA preview**.

The root package currently declares `1.2.0`, and no Git tags were found locally or on the origin during the 2026-10-26 audit. The RC tag is a proposal for the first tagged preview, not a claim that a stable 1.2.0 has shipped. The approved changes add license/dependency metadata without a version bump. If release tooling requires exact tag/package-version equality, decide that in the release change.

Use the reviewed source commit after documentation and prerequisite fixes are committed. The inspected application baseline is `f510b07`; do not tag that baseline as though it contains the new documentation.

The first prerelease should cover **source installation of the Web/PWA**. Android and native iOS source remain in the repository with their own guides and explicit validation status. Do not advertise new verified mobile binaries.

## Draft release notes

> Downlink provides a self-hosted browser interface for preparing MP4 video and MP3 audio from supported media links. This source preview documents the Web/PWA workflow and the separate native platform projects.
>
> **Verified locally after the approved improvements**
>
> - Node installation from the lockfile, server startup and serving the web/PWA assets.
> - 124 passing Node tests covering URL/provider rules, metadata and quality handling, Instagram selection/session boundaries, progress, cancellation, PWA download-session persistence and local-only/explicit wildcard listener behavior.
> - Localhost-only listening by default, with explicit `HOST` configuration for LAN/PWA access.
> - Updated npm dependencies with zero known vulnerabilities reported by `npm audit` on 2026-10-26.
> - Browser checks in Chrome and WebKit using the real interface/service worker and a synthetic API: MP4/MP3 job flows, saving, reload and offline recovery, expiry, cancellation and cache isolation.
> - 10 passing Python engine tests for the native iOS project. These are engine/adapter checks, not an iOS app build.
> - English and Spanish project overviews, real web UI screenshots, contributor instructions and a responsible disclosure policy.
> - A GPL-3.0-only license for first-party code, retaining third-party terms, and a CI workflow for Node, Python, browser and dependency checks. Remote workflow execution has not yet been verified.
>
> **Installation**
>
> Clone the tagged source, install Node.js 22 and npm, run `npm ci` followed by `npm start`, and open http://localhost:3000. Internet access and local writable storage are required. Follow the PWA guide for trusted HTTPS and Safari installation.
>
> **Limitations**
>
> Live downloads from the named platforms and authenticated Instagram access were not revalidated in this audit. Availability depends on upstream extractors, permissions and the source content. The PWA needs its Node server for extraction/conversion and does not cache media for offline downloads.
>
> The browser test now waits for animation and pointer preconditions before measuring the spotlight; the earlier intermittent assertion remains in the validation history. Android tests/builds were blocked by a missing SDK. Native iOS Swift compilation, XCTest and physical-device behavior remain unverified.
>
> No Android APK, native iOS IPA, store publication or automatic release workflow is included in this proposal.

This draft must be reconciled with the actual release commit and new validation before publication. In particular, report any dependency findings still present rather than copying an outdated audit summary.

## Gates before approval to publish

- [x] Owner approves the root GPL-3.0-only scope; root license applied and existing third-party notices retained.
- [x] Update affected npm dependencies and validate with clean installation, tests and a zero-advisory audit.
- [x] Synchronize the browser test's animation/pointer preconditions and pass the full local suite without suppressing assertions.
- [ ] Review the first remote CI runs and record validation for the exact release commit.
- [ ] Review redistribution/source obligations for every actual bundled binary if binaries are included.
- [ ] Verify clean source installation, including the first extractor download, on the intended supported host platforms.
- [ ] Run a maintained secret scanner on the intended release history and inspect the actual source archive. Include documentation screenshots; exclude local downloads, generated artifacts, signing material and credentials.
- [ ] Confirm the private disclosure channel is available and the SECURITY.md fallback is usable.
- [ ] Review the release title, tag, scope and notes with the owner and obtain explicit publication approval.

Android binary distribution should be a separate reviewed deliverable: build and test the exact APKs, confirm the signing/update policy, publish checksums for those bytes and satisfy component/source obligations. Historical APK hashes do not validate a newly built file.

Native iOS distribution needs a successful Mac build, executed native tests, device validation and a licensing/signing/distribution review. The existing Python tests alone cannot support an installable-iOS release claim.
