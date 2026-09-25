#!/usr/bin/env bash
set -euo pipefail
downlink_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$downlink_root/scripts/android-env.sh"
cd "$downlink_root/android"
downlink_serial="${1:-emulator-5554}"
downlink_variant="${2:-debug}"
if [[ "$downlink_variant" != release && "$downlink_variant" != debug ]]; then
    echo "Usage: scripts/test-android.sh [emulator-serial] [debug|release]" >&2; exit 1
fi
if [[ "$downlink_serial" != emulator-* ]]; then
    echo "This script only runs against an Android emulator." >&2; exit 1
fi
adb -s "$downlink_serial" get-state >/dev/null
if [[ "$downlink_variant" == release ]]; then
    if [[ ! -f signing.properties ]]; then
        echo "Build the personal signed release first with scripts/build-android.sh." >&2; exit 1
    fi
    ./gradlew --console=plain -PdownlinkTestBuildType=release :app:testDebugUnitTest :app:assembleRelease :app:assembleReleaseAndroidTest :app:lintRelease
else
    ./gradlew --console=plain :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
fi
adb -s "$downlink_serial" install -r "app/build/outputs/apk/$downlink_variant/app-x86_64-$downlink_variant.apk"
adb -s "$downlink_serial" install -r "app/build/outputs/apk/androidTest/$downlink_variant/app-$downlink_variant-androidTest.apk"
mkdir -p "$downlink_root/artifacts/emulator"
downlink_report="$downlink_root/artifacts/emulator/tests-$downlink_serial-$downlink_variant.txt"
adb -s "$downlink_serial" shell am instrument -w \
    -e class app.downlink.android.AndroidDownloadTest \
    app.downlink.android.test/androidx.test.runner.AndroidJUnitRunner | tee "$downlink_report"
rg -q '^OK \([0-9]+ tests?\)' "$downlink_report"
if [[ -n "${DOWNLINK_LIVE_URL:-}" ]]; then
    # adb shell invokes a remote shell; limit input to URL characters before passing it.
    if [[ ! "$DOWNLINK_LIVE_URL" =~ ^https?://[a-zA-Z0-9./_?=%:+\&@~-]+$ ]]; then
        echo "Use a plain HTTP(S) URL without shell metacharacters." >&2; exit 1
    fi
    adb -s "$downlink_serial" shell am instrument -w \
        -e class app.downlink.android.ExternalSmokeTest -e liveUrl "'$DOWNLINK_LIVE_URL'" \
        app.downlink.android.test/androidx.test.runner.AndroidJUnitRunner | tee "$downlink_root/artifacts/emulator/live-$downlink_serial.txt"
    rg -q '^OK \(1 test\)' "$downlink_root/artifacts/emulator/live-$downlink_serial.txt"
fi
