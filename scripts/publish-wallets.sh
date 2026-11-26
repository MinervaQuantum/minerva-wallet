#!/usr/bin/env bash
# Publishes a built wallet release (release/<version>/ from scripts/release-wallets.sh) to the
# testnet site: signs SHA256SUMS with the ML-DSA-65 wallet release key, ships the public key,
# and uploads everything to https://testnet.minervachain.org/downloads/<version>/.
#
#   MINERVA_RELEASE_DIR=release/0.1.0 bash scripts/publish-wallets.sh
# Needs: ssh alias minerva-testnet, ~/.minerva/wallet-release.seed (signing key, never leaves
# this machine) and ~/.minerva/wallet-release.pub (published next to the artifacts).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK_DIR="$(cd "$ROOT_DIR/../network" && pwd)"
VERSION="$(node -e 'console.log(require(process.argv[1]).expo.version)' "$ROOT_DIR/apps/mobile/app.json")"
DIR="${MINERVA_RELEASE_DIR:-$ROOT_DIR/release/$VERSION}"
HOST="${MINERVA_PUBLISH_HOST:-minerva-testnet}"
WEBROOT="${MINERVA_PUBLISH_WEBROOT:-/var/www/minerva-testnet/downloads}"
SEED="${MINERVA_RELEASE_PQ_SEED_FILE:-$HOME/.minerva/wallet-release.seed}"
PUB="${MINERVA_RELEASE_PQ_PUBLIC_KEY_FILE:-$HOME/.minerva/wallet-release.pub}"
log() { echo "[publish-wallets] $*"; }

[[ -d "$DIR" ]] || { echo "release dir missing: $DIR" >&2; exit 1; }
[[ -f "$SEED" && -f "$PUB" ]] || { echo "wallet release key missing ($SEED / $PUB); run: pnpm --filter @minerva/pq-native-tx release:pq keygen" >&2; exit 1; }
cd "$DIR"
rm -f SHA256SUMS SHA256SUMS.mldsa65.json wallet-release.pub
sha256sum -- * > SHA256SUMS
cp "$PUB" wallet-release.pub
(cd "$NETWORK_DIR" && pnpm --silent --filter @minerva/pq-native-tx release:pq sign "$SEED" "$DIR/SHA256SUMS" "$DIR/SHA256SUMS.mldsa65.json" | grep -v npmrc)
(cd "$NETWORK_DIR" && pnpm --silent --filter @minerva/pq-native-tx release:pq verify "$PUB" "$DIR/SHA256SUMS" "$DIR/SHA256SUMS.mldsa65.json" | grep -v npmrc)
log "uploading $(ls | wc -l) files to $HOST:$WEBROOT/$VERSION/"
ssh "$HOST" "sudo -n mkdir -p '$WEBROOT/$VERSION' && sudo -n chown ubuntu:ubuntu '$WEBROOT/$VERSION'"
rsync -az --delete -e ssh ./ "$HOST:$WEBROOT/$VERSION/"
ssh "$HOST" "sudo -n chown -R root:root '$WEBROOT/$VERSION' && sudo -n chmod -R a+rX '$WEBROOT/$VERSION'"
# Release manifest for the in-app update check (packages/core/src/releases.ts).
MANIFEST="$(mktemp)"
python3 - "$VERSION" "$DIR" > "$MANIFEST" <<'PYEOF'
import json, os, sys, datetime
version, folder = sys.argv[1], sys.argv[2]
files = []
for line in open(os.path.join(folder, "SHA256SUMS")):
    digest, name = line.split(None, 1); name = name.strip().lstrip("*")
    files.append({"name": name, "sha256": digest, "size": os.path.getsize(os.path.join(folder, name))})
print(json.dumps({
  "version": version,
  "publishedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "baseUrl": f"https://testnet.minervachain.org/downloads/{version}/",
  "files": files,
  "checksums": "SHA256SUMS",
  "signature": "SHA256SUMS.mldsa65.json",
  "publicKey": "wallet-release.pub",
}, indent=2))
PYEOF
scp -q "$MANIFEST" "$HOST:/tmp/minerva-latest.json"
ssh "$HOST" "sudo -n mv /tmp/minerva-latest.json '$WEBROOT/latest.json' && sudo -n chown root:root '$WEBROOT/latest.json' && sudo -n chmod a+r '$WEBROOT/latest.json'"
rm -f "$MANIFEST"
log "manifest: https://testnet.minervachain.org/downloads/latest.json"
log "published: https://testnet.minervachain.org/downloads/$VERSION/"
curl -s -m 10 "https://testnet.minervachain.org/downloads/$VERSION/SHA256SUMS" | sed 's/^/[publish-wallets]   /'
