#!/bin/bash
# SupaFantastic installer — /pod edition
# ======================================
# One-time setup:
#   - Copies maestro_runpod.py, maestro_vast.py, app.py, supa.sh → ~/pod/
#   - Installs Python deps
#   - Generates ~/.ssh/pod_key if missing
#   - Creates ~/pod/supa_config.env if missing
#   - Adds `sf` alias to ~/.bashrc and ~/.zshrc
#
# Re-runnable safely.

set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/pod"
SSH_KEY="${HOME}/.ssh/pod_key"
CONFIG="${DEST}/supa_config.env"
BASHRC="${HOME}/.bashrc"

REQUIRED_FILES=(maestro_runpod.py maestro_vast.py app.py supa.sh)

echo "==> Source: ${SRC}"
echo "==> Dest:   ${DEST}"
echo

# ── Preflight ──────────────────────────────────────────────────────────────
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "${SRC}/${f}" ]; then
    echo "ERROR: missing source file: ${SRC}/${f}"
    exit 1
  fi
done

# ── Create dest dir ────────────────────────────────────────────────────────
echo "==> Creating ${DEST}/"
mkdir -p "${DEST}"
chmod 700 "${DEST}"

# ── Copy scripts (skip if src == dest) ────────────────────────────────────
echo "==> Copying scripts"
for f in "${REQUIRED_FILES[@]}"; do
  if [ "$(realpath "${SRC}/${f}")" = "$(realpath "${DEST}/${f}" 2>/dev/null || echo '')" ]; then
    echo "  ${f} — already in place"
  else
    cp "${SRC}/${f}" "${DEST}/${f}"
    echo "  ${f}"
  fi
done
chmod +x "${DEST}/supa.sh"

# ── React build ────────────────────────────────────────────────────────────
FRONTEND_DIR="${DEST}/SupaFantasticLLM/app/frontend"
if [ -d "${FRONTEND_DIR}" ]; then
  if [ ! -d "${FRONTEND_DIR}/build" ]; then
    echo "==> Building React UI..."
    (cd "${FRONTEND_DIR}" && npm install --silent && npm run build)
    echo "  Built."
  else
    echo "==> React build exists — skipping (run 'npm run build' manually to update)"
  fi
else
  echo "==> React source not found at ${FRONTEND_DIR}"
  echo "    Clone the repo into ${DEST}/SupaFantasticLLM first."
fi

# ── Python deps ────────────────────────────────────────────────────────────
echo "==> Python deps"
NEEDED=()
python3 -c "import flask"         2>/dev/null || NEEDED+=(flask)
python3 -c "import flask_cors"    2>/dev/null || NEEDED+=(flask-cors)
python3 -c "import requests"      2>/dev/null || NEEDED+=(requests)
python3 -c "import paramiko"      2>/dev/null || NEEDED+=(paramiko)
python3 -c "import flask_sock"    2>/dev/null || NEEDED+=(flask-sock)

if [ ${#NEEDED[@]} -gt 0 ]; then
  echo "  Installing: ${NEEDED[*]}"
  python3 -m pip install --user --quiet "${NEEDED[@]}"
else
  echo "  All deps already installed."
fi

# ── SSH key ────────────────────────────────────────────────────────────────
echo "==> SSH key"
if [ ! -f "${SSH_KEY}" ]; then
  mkdir -p "$(dirname "${SSH_KEY}")"
  chmod 700 "$(dirname "${SSH_KEY}")"
  ssh-keygen -t ed25519 -f "${SSH_KEY}" -N "" -C "pod_key_supafantastic"
  echo "  Created ${SSH_KEY}"
else
  echo "  ${SSH_KEY} already exists."
fi
chmod 600 "${SSH_KEY}"

echo
echo "  Public key (add to console.vast.ai/manage-keys/ and RunPod console):"
echo "  ──────────────────────────────────────────────────────────────────────"
cat "${SSH_KEY}.pub"
echo "  ──────────────────────────────────────────────────────────────────────"
echo

# ── Config ─────────────────────────────────────────────────────────────────
echo "==> Config file"
if [ ! -f "${CONFIG}" ]; then
  cat > "${CONFIG}" << 'EOF'
# SupaFantastic config — fill in API keys, rest is managed automatically.

# ── API keys ──────────────────────────────────────────────────────────────
RUNPOD_API_KEY=""           # RunPod console → API Keys
VAST_API_KEY=""             # console.vast.ai/api-keys
HF_TOKEN=""                 # HuggingFace — optional, improves download rate

# ── Runtime state (managed by maestro — do not edit manually) ─────────────
PROVIDER=""                 # "runpod" | "vast"
ACTIVE_MODEL="qwen-coder"   # qwen-coder | deepseek-r1

# RunPod
POD_ID=""
SSH_HOST=""
SSH_PORT=""

# Vast.ai
VAST_INSTANCE_ID=""
VAST_SSH_HOST=""
VAST_SSH_PORT=""
VAST_VLLM_URL=""
EOF
  chmod 600 "${CONFIG}"
  echo "  Created ${CONFIG}"
  echo "  >>> EDIT IT: fill in RUNPOD_API_KEY and/or VAST_API_KEY"
else
  echo "  ${CONFIG} already exists — leaving as-is."
fi

# ── sf alias ───────────────────────────────────────────────────────────────
echo "==> sf alias"
ALIAS_LINE="alias sf='${DEST}/supa.sh'"

add_alias() {
  local rc="$1"
  [ -f "${rc}" ] || return 0
  # Wipe every existing sf alias line regardless of path
  sed -i '/^alias sf=/d' "${rc}"
  # Append fresh one
  { echo ""; echo "# SupaFantastic launcher"; echo "${ALIAS_LINE}"; } >> "${rc}"
  echo "  Set in ${rc}: ${ALIAS_LINE}"
}

add_alias "${BASHRC}"
[ -f "${HOME}/.zshrc" ] && add_alias "${HOME}/.zshrc"

# Apply immediately to current shell without requiring source
eval "${ALIAS_LINE}"
echo "  Alias active in this shell now (no source needed)"

# ── Done ───────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════"
echo "  ✅ SupaFantastic install complete"
echo "════════════════════════════════════════════════════════════"
echo
echo "  1. Edit ${CONFIG}"
echo "     Fill in RUNPOD_API_KEY and/or VAST_API_KEY"
echo
echo "  2. Add SSH public key (shown above) to:"
echo "     • RunPod:   console.runpod.io → Settings → SSH Keys"
echo "     • Vast.ai:  console.vast.ai/manage-keys/"
echo
echo "  3. Reload shell:"
echo "     source ~/.bashrc"
echo
echo "  4. Launch:"
echo "     sf"
echo
echo "  Browser opens at http://localhost:5000"
echo "════════════════════════════════════════════════════════════"