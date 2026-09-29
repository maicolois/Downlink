#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VENDOR_DIR="$PROJECT_ROOT/Vendor"
PYTHON_PACKAGES="$PROJECT_ROOT/python-packages"
FONT_DIR="$PROJECT_ROOT/Resources/Fonts"
ICON_DIR="$PROJECT_ROOT/Resources/Assets.xcassets/AppIcon.appiconset"

PYTHON_URL="https://github.com/beeware/Python-Apple-support/releases/download/3.13-b15/Python-3.13-iOS-support.b15.tar.gz"
PYTHON_SHA="80175765a31babe43b0910395cf86ba4e8412adf1902b069d55b74d523ecc5d1"
FFMPEG_URL="https://github.com/tfourj/SwiftFFmpeg-iOS/releases/download/1.1.0/SwiftFFmpeg-iOS.zip"
FFMPEG_SHA="1df91d7b57e089fad6547fcabb589942590794f074f99571bd43235e3b5662e5"
FONT_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/spicyrice/SpicyRice-Regular.ttf"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este script debe ejecutarse en macOS con Xcode instalado." >&2
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Instala Xcode y selecciónalo con xcode-select antes de continuar." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install python
  else
    echo "Falta Python 3. Instálalo o instala Homebrew antes de continuar." >&2
    exit 1
  fi
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install xcodegen
  else
    echo "Falta XcodeGen. Instálalo desde https://github.com/yonaskolb/XcodeGen" >&2
    exit 1
  fi
fi

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/downlink-ios.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

verify_sha256() {
  EXPECTED=$1
  FILE=$2
  ACTUAL=$(shasum -a 256 "$FILE" | awk '{print $1}')
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "Hash SHA-256 incorrecto para $FILE" >&2
    echo "Esperado: $EXPECTED" >&2
    echo "Obtenido: $ACTUAL" >&2
    exit 1
  fi
}

mkdir -p "$VENDOR_DIR" "$FONT_DIR" "$ICON_DIR"

echo "Descargando CPython 3.13 para iOS…"
curl --fail --location --retry 3 --output "$WORK_DIR/python.tar.gz" "$PYTHON_URL"
verify_sha256 "$PYTHON_SHA" "$WORK_DIR/python.tar.gz"
mkdir -p "$WORK_DIR/python"
tar -xzf "$WORK_DIR/python.tar.gz" -C "$WORK_DIR/python"
rm -rf "$VENDOR_DIR/Python.xcframework"
cp -R "$WORK_DIR/python/Python.xcframework" "$VENDOR_DIR/Python.xcframework"

echo "Descargando FFmpeg nativo…"
curl --fail --location --retry 3 --output "$WORK_DIR/ffmpeg.zip" "$FFMPEG_URL"
verify_sha256 "$FFMPEG_SHA" "$WORK_DIR/ffmpeg.zip"
mkdir -p "$WORK_DIR/ffmpeg"
ditto -x -k "$WORK_DIR/ffmpeg.zip" "$WORK_DIR/ffmpeg"
FFMPEG_PACKAGE_FILE=$(find "$WORK_DIR/ffmpeg" -maxdepth 4 -name Package.swift -print | head -n 1)
if [ -z "$FFMPEG_PACKAGE_FILE" ]; then
  echo "El paquete descargado no contiene Package.swift." >&2
  exit 1
fi
FFMPEG_PACKAGE_DIR=$(dirname "$FFMPEG_PACKAGE_FILE")
rm -rf "$VENDOR_DIR/SwiftFFmpeg-iOS"
cp -R "$FFMPEG_PACKAGE_DIR" "$VENDOR_DIR/SwiftFFmpeg-iOS"

echo "Preparando yt-dlp y el motor JavaScript WebKit…"
rm -rf "$PYTHON_PACKAGES"
mkdir -p "$PYTHON_PACKAGES"
python3 -m pip install \
  --disable-pip-version-check \
  --no-compile \
  --no-deps \
  --target "$PYTHON_PACKAGES" \
  "yt-dlp==2026.8.19" \
  "yt-dlp-ejs==0.8.0" \
  "yt-dlp-apple-webkit-jsi==0.1.1" \
  "certifi==2026.2.25"
find "$PYTHON_PACKAGES" -type d -name __pycache__ -prune -exec rm -rf {} +

echo "Preparando tipografía e icono…"
curl --fail --location --retry 3 --output "$FONT_DIR/SpicyRice-Regular.ttf" "$FONT_URL"
xcrun swift "$PROJECT_ROOT/Scripts/generate-icon.swift" "$ICON_DIR/AppIcon-1024.png"

cd "$PROJECT_ROOT"
xcodegen generate
xcodebuild -resolvePackageDependencies -project Downlink.xcodeproj -scheme Downlink

echo
echo "Proyecto generado: $PROJECT_ROOT/Downlink.xcodeproj"
echo "Ábrelo, selecciona tu Team en Signing & Capabilities y ejecuta en tu iPhone."
