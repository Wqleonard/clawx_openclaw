#!/usr/bin/env bash
set -euo pipefail

KIT_URL="${KIT_URL:-https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz}"
INSTALL_BASE="${HOME}/.skillhub"
BIN_DIR="${HOME}/.local/bin"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Error: missing required command: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd tar
need_cmd python3

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[1/5] Downloading kit..."
curl -fsSL "$KIT_URL" -o "$TMP_DIR/latest.tar.gz"

echo "[2/5] Extracting..."
tar -xzf "$TMP_DIR/latest.tar.gz" -C "$TMP_DIR"

if [[ -f "$TMP_DIR/cli/skills_store_cli.py" ]]; then
  CLI_SRC_DIR="$TMP_DIR/cli"
elif [[ -f "$TMP_DIR/skills_store_cli.py" ]]; then
  CLI_SRC_DIR="$TMP_DIR"
else
  echo "Error: skills_store_cli.py not found in package" >&2
  find "$TMP_DIR" -maxdepth 3 -type f >&2 || true
  exit 1
fi

echo "[3/5] Installing CLI files..."
mkdir -p "$INSTALL_BASE" "$BIN_DIR"

cp "$CLI_SRC_DIR/skills_store_cli.py" "$INSTALL_BASE/skills_store_cli.py"
cp "$CLI_SRC_DIR/skills_upgrade.py" "$INSTALL_BASE/skills_upgrade.py"
cp "$CLI_SRC_DIR/version.json" "$INSTALL_BASE/version.json"
cp "$CLI_SRC_DIR/metadata.json" "$INSTALL_BASE/metadata.json"

if [[ -f "$CLI_SRC_DIR/skills_index.local.json" ]]; then
  cp "$CLI_SRC_DIR/skills_index.local.json" "$INSTALL_BASE/skills_index.local.json"
fi

chmod +x "$INSTALL_BASE/skills_store_cli.py"

cat > "$BIN_DIR/skillhub" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec python3 "${HOME}/.skillhub/skills_store_cli.py" "$@"
WRAPPER
chmod +x "$BIN_DIR/skillhub"

cat > "$BIN_DIR/skillhub-local" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec python3 "${HOME}/.skillhub/skills_store_cli.py" "$@"
WRAPPER
chmod +x "$BIN_DIR/skillhub-local"

cat > "$BIN_DIR/oc-skills" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec "${HOME}/.local/bin/skillhub" "$@"
WRAPPER
chmod +x "$BIN_DIR/oc-skills"

echo "[4/5] Writing default config if missing..."
if [[ ! -f "$INSTALL_BASE/config.json" ]]; then
  cat > "$INSTALL_BASE/config.json" <<'JSON'
{
  "self_update_url": "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/version.json"
}
JSON
fi

echo "[5/5] Verifying..."
python3 "$INSTALL_BASE/skills_store_cli.py" --version

echo
echo "Install complete."
echo "CLI script: $INSTALL_BASE/skills_store_cli.py"
echo "Wrapper:    $BIN_DIR/skillhub"
echo "Wrapper:    $BIN_DIR/skillhub-local"
echo
echo "If 'skillhub' not found, add this to your shell profile:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo
echo "Quick test:"
echo "  skillhub-local search calendar"
