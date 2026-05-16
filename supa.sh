#!/bin/bash
# Local launcher — single command to bring up the SupaFantastic control plane.
# Run this on your laptop; it has nothing to do with the pod.
set -e

RUNPOD_DIR="${RUNPOD_DIR:-$HOME/runpod}"
FRONTEND_DIR="${FRONTEND_DIR:-$HOME/SupaFantasticLLM/app/frontend}"
APP_PY="${APP_PY:-$RUNPOD_DIR/app.py}"

# Build the React app if a build doesn't exist yet, so Flask can serve it.
# Skip if you prefer `npm start` in another terminal.
if [ -d "$FRONTEND_DIR" ] && [ ! -f "$FRONTEND_DIR/build/index.html" ]; then
  echo "No React build found; running `npm run build` once..."
  ( cd "$FRONTEND_DIR" && npm install --silent && npm run build )
fi

# Open browser after a short delay so Flask has time to bind.
( sleep 2 && xdg-open "http://localhost:5000" >/dev/null 2>&1 || \
              open       "http://localhost:5000" >/dev/null 2>&1 ) &

exec python3 "$APP_PY"
