#!/usr/bin/env bash
set -euo pipefail
downlink_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$downlink_root/scripts/android-env.sh"
downlink_variant="${1:-release}"
if [[ "$downlink_variant" != release && "$downlink_variant" != debug ]]; then
    echo "Usage: scripts/build-android.sh [release|debug]" >&2
    exit 1
fi
cd "$downlink_root/android"
if [[ "$downlink_variant" == release && ! -f signing.properties ]]; then
    # Personal signing identity: generated once, never tracked or printed.
    python3 - <<'PY'
import os, pathlib, secrets, subprocess
directory = pathlib.Path('.signing')
directory.mkdir(mode=0o700, exist_ok=True)
keystore = directory / 'downlink-personal.jks'
if keystore.exists():
    raise SystemExit('Signing key exists but signing.properties is missing. Restore signing.properties to keep the same signing identity.')
password = secrets.token_urlsafe(32)
env = dict(os.environ, DOWNLINK_STORE_PASSWORD=password)
subprocess.run(['keytool', '-genkeypair', '-keystore', str(keystore), '-storetype', 'PKCS12',
                '-storepass:env', 'DOWNLINK_STORE_PASSWORD', '-keypass:env', 'DOWNLINK_STORE_PASSWORD',
                '-alias', 'downlink', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
                '-dname', 'CN=Downlink Personal, O=Personal, C=ES'], env=env, check=True)
keystore.chmod(0o600)
with os.fdopen(os.open('signing.properties', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
    output.write(f'storeFile={keystore}\nstorePassword={password}\nkeyAlias=downlink\nkeyPassword={password}\n')
print('Created your local signing identity. Keep android/.signing and android/signing.properties for future updates.')
PY
fi
if [[ "$downlink_variant" == release ]]; then
    ./gradlew --console=plain :app:assembleRelease :app:testDebugUnitTest :app:lintRelease
else
    ./gradlew --console=plain :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
fi
python3 - "$downlink_variant" <<'PY'
import hashlib, json, pathlib, shutil, sys
variant = sys.argv[1]
source = pathlib.Path('app/build/outputs/apk') / variant
out = pathlib.Path('../artifacts'); out.mkdir(exist_ok=True)
metadata = json.loads((source / 'output-metadata.json').read_text())
checksums = []
for element in metadata['elements']:
    abi = next(f['value'] for f in element['filters'] if f['filterType'] == 'ABI')
    suffix = '' if variant == 'release' else '-debug'
    name = f"Downlink-{element['versionName']}{suffix}-{abi}.apk"
    target = out / name
    shutil.copyfile(source / element['outputFile'], target)
    checksums.append(f'{hashlib.sha256(target.read_bytes()).hexdigest()}  {name}')
    print(f'APK: {target.resolve()} ({target.stat().st_size / 1024 / 1024:.1f} MiB)')
(out / f'SHA256SUMS-{variant}.txt').write_text('\n'.join(checksums) + '\n')
PY
