#!/bin/bash
# ============================================================
# SupaFantastic LLM — RunPod Setup Script
# Run this in the RunPod Web Terminal or via SSH
#
# Usage:
#   chmod +x runpod-setup.sh
#   ./runpod-setup.sh
# ============================================================

set -e

WORKSPACE="/workspace"
APP_DIR="${WORKSPACE}/supafantastic-llm"
MODEL_DIR="${WORKSPACE}/ollama_models"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${CYAN}[→]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

echo ""
echo "============================================"
echo "  SupaFantastic LLM — RunPod Setup"
echo "============================================"
echo ""

# ─────────────────────────────────────
# 1. INSTALL OLLAMA
# ─────────────────────────────────────
if command -v ollama &> /dev/null; then
    log "Ollama already installed: $(ollama --version 2>/dev/null || echo 'found')"
else
    info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    log "Ollama installed"
fi

# ─────────────────────────────────────
# 2. PERSIST MODELS ON VOLUME
# ─────────────────────────────────────
info "Setting up persistent model storage at ${MODEL_DIR}..."
mkdir -p "${MODEL_DIR}"
mkdir -p ~/.ollama
rm -rf ~/.ollama/models 2>/dev/null || true
ln -sf "${MODEL_DIR}" ~/.ollama/models
log "Model directory symlinked to volume"

# ─────────────────────────────────────
# 3. START OLLAMA SERVER
# ─────────────────────────────────────
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    log "Ollama server already running"
else
    info "Starting Ollama server..."
    OLLAMA_HOST=0.0.0.0 OLLAMA_KEEP_ALIVE=15m nohup ollama serve > /tmp/ollama.log 2>&1 &
    
    # Wait for it
    for i in $(seq 1 15); do
        if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        log "Ollama server running"
    else
        warn "Ollama server may not have started. Check /tmp/ollama.log"
    fi
fi

# ─────────────────────────────────────
# 4. PULL MODELS
# ─────────────────────────────────────
MODELS=(
    "gemma4"
    "qwen3:32b"
    "deepseek-coder"
    "deepseek-r1:32b"
)

echo ""
info "Pulling ${#MODELS[@]} models (this may take 15-30 min on first run)..."
echo ""

for model in "${MODELS[@]}"; do
    # Check if already downloaded
    if ollama list 2>/dev/null | grep -q "${model}"; then
        log "${model} — already installed, skipping"
    else
        info "Pulling ${model}..."
        ollama pull "${model}"
        log "${model} — done"
    fi
done

echo ""
log "All models installed:"
ollama list
echo ""

# ─────────────────────────────────────
# 5. INSTALL NODE.JS (if needed)
# ─────────────────────────────────────
if command -v node &> /dev/null; then
    log "Node.js already installed: $(node --version)"
else
    info "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    log "Node.js installed: $(node --version)"
fi

# ─────────────────────────────────────
# 6. INSTALL PYTHON DEPS
# ─────────────────────────────────────
info "Installing Python dependencies..."
pip install --quiet flask flask-cors requests gunicorn 2>/dev/null || \
pip install --quiet --break-system-packages flask flask-cors requests gunicorn
log "Python dependencies installed"

# ─────────────────────────────────────
# 7. SET UP APP DIRECTORY
# ─────────────────────────────────────
if [ -d "${APP_DIR}" ]; then
    log "App directory exists at ${APP_DIR}"
else
    info "Creating app directory at ${APP_DIR}..."
    mkdir -p "${APP_DIR}/frontend"
    warn "Copy your app.py and frontend/ files into ${APP_DIR}"
fi

# ─────────────────────────────────────
# 8. CREATE STARTUP SCRIPT
# ─────────────────────────────────────
cat > "${WORKSPACE}/start-all.sh" << 'STARTEOF'
#!/bin/bash
# Start all services for SupaFantastic LLM
WORKSPACE="/workspace"

echo "[1/3] Starting Ollama..."
OLLAMA_HOST=0.0.0.0 OLLAMA_KEEP_ALIVE=15m nohup ollama serve > /tmp/ollama.log 2>&1 &
sleep 3

echo "[2/3] Starting Flask backend..."
cd "${WORKSPACE}/supafantastic-llm"
nohup python app.py > /tmp/flask.log 2>&1 &
sleep 1

echo "[3/3] Starting React frontend..."
cd "${WORKSPACE}/supafantastic-llm/frontend"
if [ -d "build" ]; then
    nohup npx serve -s build -l 3000 > /tmp/frontend.log 2>&1 &
else
    PORT=3000 HOST=0.0.0.0 nohup npm start > /tmp/frontend.log 2>&1 &
fi

echo ""
echo "All services started:"
echo "  Ollama:   http://localhost:11434"
echo "  Backend:  http://localhost:5000"
echo "  Frontend: http://localhost:3000"
echo ""
echo "Logs:"
echo "  tail -f /tmp/ollama.log"
echo "  tail -f /tmp/flask.log"
echo "  tail -f /tmp/frontend.log"
STARTEOF

chmod +x "${WORKSPACE}/start-all.sh"
log "Created ${WORKSPACE}/start-all.sh (run this on every pod restart)"

# ─────────────────────────────────────
# 9. VERIFY
# ─────────────────────────────────────
echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "  Models installed:"
ollama list | awk '{print "    " $0}'
echo ""
echo "  GPU status:"
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader 2>/dev/null | awk '{print "    " $0}' || echo "    (no GPU detected)"
echo ""
echo "  Next steps:"
echo "    1. Copy your app files into ${APP_DIR}/"
echo "       - app.py (backend)"
echo "       - frontend/ (React app)"
echo ""
echo "    2. Install frontend deps:"
echo "       cd ${APP_DIR}/frontend && npm install"
echo ""
echo "    3. Start everything:"
echo "       ${WORKSPACE}/start-all.sh"
echo ""
echo "    4. Access the UI at http://localhost:3000"
echo "       (or via RunPod proxy URL)"
echo ""