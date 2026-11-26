#!/usr/bin/env bash
# Builds the Minerva Wallet release artifacts for the Minerva testnet into release/<version>/:
#   extension  : Chrome MV3 and Firefox MV3 zips (plasmo)
#   web        : static Expo web export (also the desktop UI)
#   desktop    : Tauri bundles for the OS this runs on (.deb/.AppImage on Linux, .dmg on macOS, .msi/.exe on Windows)
#   android    : release APK, when ANDROID_HOME and a JDK are present (MINERVA_ANDROID_KEYSTORE signs it)
# Every artifact is listed in SHA256SUMS. Set MINERVA_SKIP=desktop,android to skip targets.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e 'console.log(require(process.argv[1]).expo.version)' "$ROOT_DIR/apps/mobile/app.json")"
OUT="${MINERVA_RELEASE_DIR:-$ROOT_DIR/release/$VERSION}"
SKIP=",${MINERVA_SKIP:-},"
export EXPO_PUBLIC_MINERVA_CHAIN_ID="${EXPO_PUBLIC_MINERVA_CHAIN_ID:-77138}"
export EXPO_PUBLIC_MINERVA_WALLET_VERSION="$VERSION"
export CI=true
mkdir -p "$OUT"
log() { echo "[release-wallets] $*"; }
skip() { [[ "$SKIP" == *",$1,"* ]]; }

log "version $VERSION, chain $EXPO_PUBLIC_MINERVA_CHAIN_ID, output $OUT"
pnpm -C "$ROOT_DIR" -r --filter './packages/**' typecheck >/dev/null
pnpm -C "$ROOT_DIR" --filter @minerva/mobile --filter @minerva/extension typecheck >/dev/null
log "typecheck ok"

if ! skip extension; then
  (cd "$ROOT_DIR/apps/extension" && rm -rf build && pnpm exec plasmo build >/dev/null && pnpm exec plasmo build --target=firefox-mv3 >/dev/null \
    && pnpm exec plasmo package >/dev/null && pnpm exec plasmo package --target=firefox-mv3 >/dev/null)
  cp "$ROOT_DIR/apps/extension/build/chrome-mv3-prod.zip" "$OUT/minerva-wallet-extension-$VERSION-chrome-mv3.zip"
  cp "$ROOT_DIR/apps/extension/build/firefox-mv3-prod.zip" "$OUT/minerva-wallet-extension-$VERSION-firefox-mv3.zip"
  log "extension ok"
fi

if ! skip web; then
  (cd "$ROOT_DIR/apps/mobile" && rm -rf dist && pnpm exec expo export --platform web >/dev/null)
  (cd "$ROOT_DIR/apps/mobile" && tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$OUT/minerva-wallet-web-$VERSION.tar.gz" dist)
  log "web export ok"
fi

if ! skip desktop; then
  if command -v cargo >/dev/null; then
    export APPIMAGE_EXTRACT_AND_RUN=1
    # Tauri leaves earlier bundles in place; start from a clean bundle directory so only this
    # version's files can be picked up below.
    rm -rf "$ROOT_DIR/apps/desktop/src-tauri/target/release/bundle"
    (cd "$ROOT_DIR/apps/desktop" && pnpm exec tauri build >/dev/null)
    # Tauri names bundles after the product name ("Minerva Wallet_0.1.0_amd64.deb"); publish them
    # with hyphenated names and the OS/arch in the file name.
    find "$ROOT_DIR/apps/desktop/src-tauri/target/release/bundle" -type f -name "*${VERSION}*" \( -name '*.deb' -o -name '*.AppImage' -o -name '*.dmg' -o -name '*.msi' -o -name '*.exe' -o -name '*.rpm' \) | while read -r bundle; do
      ext="${bundle##*.}"
      case "$ext" in
        deb|AppImage|rpm) os="linux" ;;
        dmg) os="macos" ;;
        msi|exe) os="windows" ;;
        *) os="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
      esac
      cp "$bundle" "$OUT/minerva-wallet-$VERSION-$os-$(uname -m).$ext"
    done
    log "desktop ok"
  else
    log "desktop skipped: cargo not installed"
  fi
fi

if ! skip android; then
  if [[ -n "${ANDROID_HOME:-}" ]] && command -v java >/dev/null; then
    (cd "$ROOT_DIR/apps/mobile" && rm -rf android && pnpm exec expo prebuild --platform android --no-install >/dev/null)
    # Expo SDK 52 ships Compose compiler 1.5.15 (built for Kotlin 1.9.25) while React Native
    # 0.76.5's Gradle plugin pins Kotlin 1.9.24; the two are source compatible, so relax the
    # compiler's strict version check for every Kotlin compile task (expo-modules-core included).
    cat >> "$ROOT_DIR/apps/mobile/android/build.gradle" <<'GRADLE'

allprojects {
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        kotlinOptions.freeCompilerArgs += ["-P", "plugin:androidx.compose.compiler.plugins.kotlin:suppressKotlinVersionCompatibilityCheck=1.9.24"]
    }
}
GRADLE
    if [[ -n "${MINERVA_ANDROID_KEYSTORE:-}" ]]; then
      # Release signing from the operator's keystore (never in the repository).
      cat >> "$ROOT_DIR/apps/mobile/android/gradle.properties" <<PROPS
MINERVA_UPLOAD_STORE_FILE=$MINERVA_ANDROID_KEYSTORE
MINERVA_UPLOAD_STORE_PASSWORD=${MINERVA_ANDROID_KEYSTORE_PASSWORD:?}
MINERVA_UPLOAD_KEY_ALIAS=${MINERVA_ANDROID_KEY_ALIAS:-minerva}
MINERVA_UPLOAD_KEY_PASSWORD=${MINERVA_ANDROID_KEY_PASSWORD:-${MINERVA_ANDROID_KEYSTORE_PASSWORD}}
PROPS
      node "$ROOT_DIR/scripts/android-release-signing.mjs" "$ROOT_DIR/apps/mobile/android/app/build.gradle"
    fi
    (cd "$ROOT_DIR/apps/mobile/android" && ./gradlew --no-daemon -q assembleRelease)
    cp "$ROOT_DIR/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" "$OUT/minerva-wallet-$VERSION-android.apk"
    log "android ok"
  else
    log "android skipped: ANDROID_HOME or java missing"
  fi
fi

(cd "$OUT" && sha256sum * > SHA256SUMS)
log "artifacts:"; ls -la "$OUT" | awk 'NR>1 {print "  " $5 "  " $9}'
