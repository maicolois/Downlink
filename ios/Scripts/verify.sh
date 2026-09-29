#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_ROOT"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "La compilación iOS debe verificarse en macOS." >&2
  exit 1
fi

for command in python3 plutil xcodegen xcodebuild; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Falta $command. Ejecuta Scripts/bootstrap.sh primero." >&2
    exit 1
  fi
done

if [ ! -d Vendor/Python.xcframework ] || [ ! -f Vendor/SwiftFFmpeg-iOS/Package.swift ] || [ ! -d python-packages/yt_dlp ]; then
  echo "Faltan dependencias nativas. Ejecuta Scripts/bootstrap.sh primero." >&2
  exit 1
fi

PYTHONPATH="$PROJECT_ROOT/python-packages${PYTHONPATH:+:$PYTHONPATH}" \
  python3 -m unittest discover -s Tests -p 'test_*.py'
plutil -lint Config/Info.plist Config/Downlink.entitlements
xcodegen generate

xcodebuild \
  -project Downlink.xcodeproj \
  -scheme Downlink \
  -configuration Debug \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$PROJECT_ROOT/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  build-for-testing

echo "Verificación completa: motor Python, configuración y compilación Swift/iOS correctos."
