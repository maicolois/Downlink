#!/usr/bin/env bash
# Source this file from the build/test scripts. It also recognizes the local toolchain.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [[ -z "${JAVA_HOME:-}" ]]; then
    for downlink_jdk in "$HOME"/.local/share/downlink-tools/jdk-17*; do
        if [[ -x "$downlink_jdk/bin/java" ]]; then export JAVA_HOME="$downlink_jdk"; break; fi
    done
fi
if [[ -n "${JAVA_HOME:-}" ]]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH"
if ! command -v java >/dev/null || [[ ! -d "$ANDROID_HOME/platforms/android-36" ]]; then
    echo "Install JDK 17 and Android SDK platform 36 first; see android/README.md." >&2
    return 1
fi
