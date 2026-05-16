#!/bin/bash
# SupaFantastic local installer
# =============================
# One-time setup on your laptop:
#   - Copy maestro_global.py, app.py, setup_supafantastic_runpod.sh, supa.sh
#     into ~/runpod/
#   - Add `sf` alias to ~/.bashrc (idempotent)
#   - Ensure ~/.ssh/runpod_supa exists
#   - Validate or create ~/runpod/supa_config.env
#
# Run from the directory containing the source files. Re-runnable safely.

set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/runpod"
BASHRC="${HOME}/.bashrc"
SSH_KEY="${HOME}/.ssh/runpod_supa"
CONFIG="${DEST}/supa_config.env"

REQUIRED_FILES=(maestro_global.py app.py setup_supafantastic_runpod.sh supa.sh)

echo "==> Source: ${SRC}"
echo "==> Dest:   ${DEST}"

for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "${SRC}/${f}" ]; then
    echo "ERROR: missing source file: ${SRC}/${f}"
    exit 1
  fi
done

echo "==> Creating ${DEST}/"
mkdir -p "${DEST}"
chmod 700 "${DEST}"

echo "==> Copying scripts"
for f in "${REQUIRED_FILES[@]}"; do
  cp "${SRC}/${f}" "${DEST}/${f}"
done
chmod +x "${DEST}/supa.sh" "${DEST}/setup_supafantastic_runpod.sh"

echo "==> Python deps"
if ! python3 -c "import flask, flask_cors, requests" >/dev/null 2>&1; then
  echo "Installing flask flask-cors requests --user..."
  python3 -m pip install --user --quiet flask flask-cors requests
else
  echo "Already installed."
fi

echo "==> SSH key"
if [ ! -f "${SSH_KEY}" ]; then
  mkdir -p "$(dirname "${SSH_KEY}")"
  chmod 700 "$(dirname "${SSH_KEY}")"
  ssh-keygen -t ed25519 -f "${SSH_KEY}" -N "" -C "runpod_supa_auto"
  echo "  Created ${SSH_KEY}"
else
  echo "  ${SSH_KEY} already exists."
fi
chmod 600 "${SSH_KEY}"

echo "==> Config file"
if [ ! -f "${CONFIG}" ]; then
  cat > "${CONFIG}" <<'EOF'
# SupaFantastic config — edit values, then save.
# ALL of these are read by maestro_global.py and app.py.

RUNPOD_API_KEY=""             # REQUIRED: from RunPod console → API Keys
HF_TOKEN=""                   # Optional: improves HuggingFace rate limits
GITHUB_TOKEN=""               # Only if you clone a private repo on pod
GITHUB_USER="j031nich0145"
REPO_NAME="SupaFantasticLLM"

POD_ID=""                     # Filled by maestro on first create
SSH_HOST=""                   # Filled by maestro after SSH succeeds
SSH_PORT=""
SSH_KEY=""                    # Filled by maestro (defaults to ~/.ssh/runpod_supa)
SSH_PUBLIC_KEY=""
UI_URL=""

ACTIVE_MODEL="qwen-coder"     # qwen-coder | deepseek-r1
EOF
  chmod 600 "${CONFIG}"
  echo "  Wrote template ${CONFIG}"
  echo "  >>> EDIT IT: at minimum, fill RUNPOD_API_KEY"
else
  echo "  ${CONFIG} already exists. Leaving as-is."
fi

echo "==> sf alias"
ALIAS_LINE="alias sf='${DEST}/supa.sh'"
if grep -qxF "${ALIAS_LINE}" "${BASHRC}" 2>/dev/null; then
  echo "  Already in ${BASHRC}"
else
  echo "" >> "${BASHRC}"
  echo "# SupaFantastic launcher" >> "${BASHRC}"
  echo "${ALIAS_LINE}" >> "${BASHRC}"
  echo "  Appended to ${BASHRC}"
fi

# Also add to zshrc if it exists (mac users)
if [ -f "${HOME}/.zshrc" ]; then
  if ! grep -qxF "${ALIAS_LINE}" "${HOME}/.zshrc"; then
    echo "" >> "${HOME}/.zshrc"
    echo "# SupaFantastic launcher" >> "${HOME}/.zshrc"
    echo "${ALIAS_LINE}" >> "${HOME}/.zshrc"
    echo "  Also appended to ${HOME}/.zshrc"
  fi
fi

echo
echo "============================================================"
echo "Install complete."
echo
echo "Next steps:"
echo "  1. Edit ${CONFIG} and set RUNPOD_API_KEY"
echo "     (rotate any leaked key from the RunPod console first)"
echo "  2. Source your shell config:    source ~/.bashrc"
echo "  3. Run:                          sf"
echo "  4. Browser opens to localhost:5000 — hit 'Start Backend'"
echo "============================================================"
