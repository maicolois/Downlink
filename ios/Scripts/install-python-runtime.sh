#!/bin/sh
set -eu

SOURCE_UTILS="$PROJECT_DIR/Vendor/Python.xcframework/build/utils.sh"
PATCHED_UTILS="$TARGET_TEMP_DIR/downlink-python-support-utils.sh"

if [ ! -f "$SOURCE_UTILS" ]; then
  echo "Falta Vendor/Python.xcframework. Ejecuta Scripts/bootstrap.sh primero." >&2
  exit 1
fi

# BeeWare firma los frameworks de extensión durante la instalación. El guard
# adicional permite también compilar el simulador o una build sin identidad.
mkdir -p "$TARGET_TEMP_DIR"
python3 - "$SOURCE_UTILS" "$PATCHED_UTILS" <<'PY'
import sys

source_path, output_path = sys.argv[1:]
text = open(source_path, encoding="utf-8").read()
needle = '''    echo "Signing framework as $EXPANDED_CODE_SIGN_IDENTITY_NAME ($EXPANDED_CODE_SIGN_IDENTITY)..."
    /usr/bin/codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" ${OTHER_CODE_SIGN_FLAGS:-} -o runtime --timestamp=none --preserve-metadata=identifier,entitlements,flags --generate-entitlement-der "$CODESIGNING_FOLDER_PATH/$FRAMEWORK_FOLDER"
'''
replacement = '''    SIGN_IDENTITY_TRIMMED=$(echo "${EXPANDED_CODE_SIGN_IDENTITY:-}" | tr -d '[:space:]')
    if [ "$EFFECTIVE_PLATFORM_NAME" = "-iphonesimulator" ] || [ "${CODE_SIGNING_ALLOWED:-YES}" != "YES" ] || [ -z "$SIGN_IDENTITY_TRIMMED" ]; then
        echo "Skipping framework signing for $FRAMEWORK_FOLDER."
    else
        echo "Signing framework as $EXPANDED_CODE_SIGN_IDENTITY_NAME ($EXPANDED_CODE_SIGN_IDENTITY)..."
        /usr/bin/codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" ${OTHER_CODE_SIGN_FLAGS:-} -o runtime --timestamp=none --preserve-metadata=identifier,entitlements,flags --generate-entitlement-der "$CODESIGNING_FOLDER_PATH/$FRAMEWORK_FOLDER"
    fi
'''
if "Skipping framework signing for $FRAMEWORK_FOLDER" not in text:
    if needle not in text:
        raise SystemExit("No se encontró el bloque de firma esperado en utils.sh")
    text = text.replace(needle, replacement, 1)
open(output_path, "w", encoding="utf-8").write(text)
PY

. "$PATCHED_UTILS"
install_python Vendor/Python.xcframework python-packages

