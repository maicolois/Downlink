# Repository audit and maintainer decisions

Audit date: **2026-10-26**. Source: `main`, commit `f510b07`. The working tree was clean before the documentation changes. The public [repository page](https://github.com/maicolois/Downlink) was inspected; it had no About description or topics. Local tags and `git ls-remote --tags origin` returned no tags.

The initial phase prepared documentation only. Following the owner's explicit approval, the local changes now also apply GPL-3.0-only to first-party code, update affected npm dependencies, bind the server to localhost by default, add connection regression tests, synchronize the browser test and implement CI. No changes have been pushed, no remote settings changed and no release created.

## Findings

| Area | Evidence and implication |
| --- | --- |
| Scope | Four variants exist. The PWA uses the Node server; native Android and iOS contain device-side engines. They need separate setup and validation statements. |
| Existing documentation | Detailed platform and Instagram instructions already exist. The root README was Spanish-only, referenced workstation paths/local APKs and did not provide a concise validation matrix. |
| Validation | After the approved changes, 124 Node and 10 Python tests pass. Chrome/WebKit also pass with explicit animation/pointer synchronization in the test. Android SDK and Apple toolchains remain unavailable. |
| Licensing | A root GPL-3.0-only license and package metadata have been added with owner approval. Android's existing license and component notices are retained; third-party components keep their own terms. |
| Screenshots | No app screenshots were tracked or locally available initially. The existing browser suite generated actual home-page captures used in the READMEs; provenance identifies emulation and synthetic API. |
| Community files | No root contributing/security policy existed. These have been added without inventing an email contact, response SLA or contributor license agreement. |
| Automation | No workflow existed initially. A local [CI workflow](../.github/workflows/ci.yml) now defines Node, Python, browser and dependency checks. [CI notes](CI_PROPOSAL.md) distinguish local checks from unverified remote runner execution. |
| Packaging | Root package version is `1.2.0`; Android is `1.0.2` (code 3); native iOS metadata is `1.0.0` (build 1). These are distinct version streams, not a verified unified release. |

See [VALIDATION.md](VALIDATION.md) for commands, environments, failures and platform limits.

## Prioritized improvement plan

| Priority | Action | State after this audit |
| --- | --- | --- |
| **P0** | Clarify license scope and secure owner's approval of a root license | Approved and applied locally; existing Android license and third-party notices retained. |
| **P0** | Triage dependency advisories and validate fixes | Affected packages updated; clean `npm ci`, tests and `npm audit` pass with zero reported vulnerabilities. |
| **P0** | Keep the web server local by default, with explicit PWA/LAN access | Implemented as `HOST=127.0.0.1` by default; real TCP/HTTP regression tests pass. |
| **P0** | Review secrets, generated output and personal paths before publication | Bounded review completed; paths generalized; no files or history deleted. |
| **P1** | Explain the four variants, install paths and actual test status | English README, Spanish translation and platform status notes prepared. |
| **P1** | Make contribution and responsible disclosure paths discoverable | CONTRIBUTING.md and SECURITY.md prepared; private reporting still needs a maintainer settings check. |
| **P1** | Add actual, traceable screenshots | Web desktop/mobile captures added; native screenshots remain pending. |
| **P1** | Establish CI and investigate the intermittent browser failure | Workflow added locally; test now waits for panel animation/stable pointer preconditions. Remote runner validation remains pending. |
| **P2** | Validate native builds/devices, component redistribution and first-run setup | Requires appropriate toolchains and separate checks. |
| **P2** | Set About metadata and publish a reviewed prerelease | Suggested metadata below and [release draft](RELEASE_PLAN.md); no remote changes. |

## Dependency review

The initial `npm audit --json` reported **five affected dependency entries: one critical, one high and three moderate** on 2026-10-26. These initial findings are retained below. Following the approved dependency updates and a clean reinstall, the same audit returns **zero known vulnerabilities**. Severity is the registry advisory rating; the initial review did not demonstrate exploitability in Downlink.

| Dependency | Audit severity | Advisory / relationship |
| --- | --- | --- |
| `proxy-addr` | Critical | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), IP spoofing involving IPv4-mapped IPv6 trust subnets |
| `body-parser` | High | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), denial of service involving compressed request bodies |
| `qs` | Moderate | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) and [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |
| `express` | Moderate | Affected through the dependency graph; the audit attributed this entry to `qs`. |
| `uuid` | Moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), bounds checks in specific UUID APIs; the inspected server imports v4. |

The resolved versions are Express **4.22.3**, body-parser **1.20.9**, proxy-addr **2.0.8**, qs **6.16.1** and uuid **14.0.3**. Express remains on major version 4. The server's existing ESM `uuid` v4 import is retained and exercised by fixture-backed API tests. Updates used explicit direct-dependency versions and a non-forced `npm audit fix`, followed by `npm ci` and the test suites. No forced upgrade or npm override was added.

The server initially used `app.listen(PORT)` without a loopback-only host. It now uses `HOST`, defaulting to `127.0.0.1`; LAN access requires an explicit address or wildcard override. `cors()` remains, and no general deployment authentication or rate-limit layer was added. The Instagram auth code still checks real loopback peers, local hosts, origin and CSRF. Connection tests confirm the default excludes another local address and explicit wildcard mode accepts it without making Instagram login available there. Public hosting still requires a deployment/security review.

The desktop extractor downloads from an unpinned upstream `latest` URL if absent. Android's bundled extractor and the native iOS binary dependencies use version/hash pins. Propose extractor pinning/checksum verification separately; changing this behavior is outside the documentation scope.

## Secrets, sensitive files and artifacts

The review included tracked filenames, historical filenames across all **21 locally reachable commits**, current text searches and **278 distinct historical text blobs**. Six signature families were searched: private-key headers and common GitHub, AWS, Google API, OpenAI and Slack token formats. No signature matches were found.

This was a bounded manual/signature review, not Gitleaks, an entropy scan, a full binary analysis or proof that the repository has never contained a secret. It did not inspect unreachable objects, other forks, remote-only branches, service-side secrets or all possible credential formats.

- No tracked/historical filenames matched the checked environment, cookie export, private signing-key, APK/IPA or generated-output patterns.
- Local `bin/`, `downloads/`, `node_modules/` and `android/.gradle/` existed and were ignored. The local downloads contain actual media and must not be included in source archives; they were not opened, modified or deleted.
- `git check-ignore` confirmed exclusions for `.env`, `cookies.txt`, `android/signing.properties`, a `.jks` signing key, `artifacts/` and `downloads/`.
- Android documentation contained personal Windows/WSL paths. They were replaced with portable descriptions while retaining installation steps, historical results and artifact hashes.
- The checked-in MP4/WebM files are instrumentation fixtures described as original synthetic test media in [Android component notices](../android/THIRD_PARTY.md). The Gradle wrapper JAR is build tooling; neither category should be removed merely for being binary.
- Screenshot files were visually reviewed: no personal accounts or private content appear in the selected home-page images.

Before public packaging, run a maintained secret scanner against the full intended history and review licenses/notices for every distributed binary. If a real credential is found, rotate it and coordinate any history cleanup; no history rewrite is authorized by this audit.

## Approved license scope

**GPL-3.0-only now applies to first-party Downlink code under the root [LICENSE](../LICENSE)**, following the owner's approval. The package and lockfile license fields agree. Third-party components retain their licenses and the existing Android license/notices remain in place.

This is a consistency recommendation: Android is already documented as GPL-3.0, and native iOS uses a GPLv3 FFmpeg package. One explicit first-party policy would be easier to explain than applying a permissive label to the whole repository while distributing GPL components. The [GNU compatibility guidance](https://www.gnu.org/licenses/gpl-faq.en.html#WhatDoesCompatMean) explains that combined-work distribution depends on the licenses involved.

The license text was copied unchanged from the existing GPLv3 text in `android/LICENSE`; the root notices and package metadata specify GPL-3.0-only. No third-party material is relicensed. This does not establish codec permissions, App Store compatibility or completion of binary corresponding-source obligations; those remain distribution checks for the actual build being shipped.

## Suggested GitHub About metadata

Description:

> Download supported online video as MP4 or MP3. Self-hosted web/PWA, standalone Android, and a native iOS project.

Topics (copy individually):

```text
video-downloader
audio-extractor
mp4
mp3
yt-dlp
ffmpeg
self-hosted
pwa
android
kotlin
ios
swiftui
nodejs
javascript
```

These describe inspected code; they make no claim about downloads, users, popularity or store availability. They have not been applied to GitHub.

## Readiness for an open-source program application

The documentation, approved license, patched dependencies and CI configuration make scope, contribution paths and validation evidence reviewable. They do not establish eligibility, acceptance, adoption or program benefits. Before applying, verify a private disclosure channel and the first remote CI runs, and present native build limitations and browser validation history honestly.

Only measured usage or maintainer evidence should be included if an application requests impact information. No usage or popularity claims were added.
