#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_JS="$ROOT/native-host/host.cjs"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then echo "需要 node"; exit 1; fi
WRAP="$ROOT/native-host/host-wrapper.sh"
cat > "$WRAP" <<EOF
#!/usr/bin/env bash
export GAMEBANANA_MODS_DOWNLOADER_CRX_DIR="$ROOT"
exec "$NODE_BIN" "$HOST_JS"
EOF
chmod +x "$WRAP"
ID="${1:-}"
MAN_DIR="${HOME}/.config/chromium/NativeMessagingHosts"
mkdir -p "$MAN_DIR"
OUT="$MAN_DIR/com.gamebanana.mods.downloader.host.json"
python3 - <<PY
import json, pathlib
p = pathlib.Path("$ROOT/native-host/com.gamebanana.mods.downloader.host.json")
obj = json.loads(p.read_text())
obj["path"] = "$WRAP"
oid = "$ID"
if oid:
    obj["allowed_origins"] = ["chrome-extension://%s/" % oid]
pathlib.Path("$OUT").write_text(json.dumps(obj, indent=2))
print("wrote", "$OUT")
PY
