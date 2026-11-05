# Security policy

## Scope and supported versions

Security reports are welcome for the current `main` branch, including the web server, PWA, local Instagram extension, Android app and native iOS project. There is no established backport policy or supported release series. Historical Android build reports do not imply ongoing support for those binaries.

Do not assume that a public repository or passing fixture tests establish suitability for an Internet-facing service.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/maicolois/Downlink/security/advisories/new) **if it is enabled** for this repository. The presence of this file does not enable that feature.

If GitHub does not offer a private reporting form, open an issue titled **Security contact request** with no vulnerability details, exploit, credentials or affected private URLs. Ask the maintainer to provide a private channel, and wait for that channel before sending details. No dedicated security email address has been designated in this repository.

Include, in the private report:

- Affected component and commit/app version.
- Operating system, runtime and relevant configuration.
- Minimal reproduction steps or a synthetic proof of concept.
- Expected versus observed behavior and potential impact.
- Any proposed mitigation, without including actual passwords, cookies, tokens or personal media.

Avoid testing against other people's accounts, devices or services. Use your own environment and authorized content.

## Coordinated disclosure

Keep exploitable details private while the maintainer investigates. Agree on a disclosure date and any advisory/CVE request through the private channel. There is no guaranteed response time, bounty or fixed remediation deadline.

The intended process is to acknowledge the report, reproduce and assess it, coordinate a fix and regression checks, and publish an advisory when appropriate. Credit the reporter with their consent. If communication stalls, request a status update through the same private channel before deciding next steps.

## Sensitive data and deployment

Treat Instagram cookies as credentials. Do not put them in issues, screenshots, CI logs or commits. The web login is designed for a local desktop connection; Android and native iOS have separate session stores.

Keep `android/signing.properties`, keystores, provisioning material, `.env*`, cookie exports, downloaded media and generated artifacts private. If a real credential is exposed, revoke or rotate it; deleting it from the current tree alone does not remove it from Git history.

The web server binds to `127.0.0.1` by default and uses external extractor/converter processes. `HOST` can explicitly enable a LAN interface or a wildcard listener; a reverse proxy can also expose the local service. Before public deployment, review dependency advisories, network exposure, authentication, resource limits and temporary-file handling. Loopback binding does not replace those deployment controls.

The dependency findings from the initial 2026-10-26 audit and their resolution are recorded in [docs/AUDIT.md](docs/AUDIT.md#dependency-review). The updated lockfile returned zero known npm advisories on that date; that is not a guarantee against undiscovered vulnerabilities. Report new project-specific exploit details through the private process above.

GitHub's [private reporting documentation](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately) explains availability and the reporting form.
