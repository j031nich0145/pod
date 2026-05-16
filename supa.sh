#!/bin/bash
# SupaFantastic launcher — runs as `sf`
# =====================================
# Builds React if needed, opens browser, starts Flask backend.

set -euo pipefail

POD_DIR="${HOME}/pod"
FRONTEND_DIR="${POD_DIR}/SupaFantasticLLM/app/frontend"
APP="${POD_DIR}/app.py"
URL="http://localhost:5000"

cd "${POD_DIR}"

# ── Sanity checks ──────────────────────────────────────────────────────────
if [ ! -f "${APP}" ]; then
  echo "ERROR: ${APP} not found. Run sf-install.sh first."
  exit 1
fi

# ── Build React if build dir is missing or src is newer ───────────────────
if [ -d "${FRONTEND_DIR}" ]; then
  BUILD_DIR="${FRONTEND_DIR}/build"
  MAIN_SRC="${FRONTEND_DIR}/src/App.js"

  if [ ! -d "${BUILD_DIR}" ]; then
    echo "==> Building React UI (first time)..."
    (cd "${FRONTEND_DIR}" && npm install --silent && npm run build)
  elif [ -f "${MAIN_SRC}" ] && [ "${MAIN_SRC}" -nt "${BUILD_DIR}/index.html" ]; then
    echo "==> App.js changed — rebuilding..."
    (cd "${FRONTEND_DIR}" && npm run build)
  fi
fi

# ── Open browser ───────────────────────────────────────────────────────────
open_browser() {
  if command -v xdg-open &>/dev/null; then
    xdg-open "${URL}" &
  elif command -v open &>/dev/null; then
    open "${URL}" &
  fi
}

echo "==> Starting SupaFantastic at ${URL}"
sleep 1 && open_browser &

# ── Launch Flask ───────────────────────────────────────────────────────────
exec python3 "${APP}"