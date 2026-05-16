# SupaFantastic LLM — RunPod Deployment Guide

## Overview

This guide walks you through deploying the SupaFantastic LLM frontend + Ollama backend on a RunPod GPU pod, with the following models pre-installed:

| Model | Ollama Name | Size | Use Case |
|-------|-------------|------|----------|
| Gemma 4 | `gemma4` | ~9.6 GB | General chat, multimodal, reasoning |
| Qwen3 32B | `qwen3:32b` | ~20 GB | All-rounder, multilingual, coding |
| DeepSeek Coder | `deepseek-coder` | ~8.5 GB | Code generation, 300+ languages |
| DeepSeek R1 32B | `deepseek-r1:32b` | ~20 GB | Deep reasoning, math, logic |

**Total disk for all models: ~60 GB**

> **Note on DeepSeek V4:** DeepSeek-V4-Flash (284B params) is currently cloud-only on Ollama. The smallest local quantization (Q4) requires ~70 GB VRAM. If your pod has the capacity, you can pull it with `ollama pull deepseek-v4-flash`, but for most setups `deepseek-r1:32b` is the practical reasoning model.

---

## 1. Choose Your Pod

### Recommended GPU Configurations

| GPU | VRAM | Can Run | Monthly Cost (approx) |
|-----|------|---------|-----------------------|
| **A6000 (48 GB)** | 48 GB | All 4 models sequentially | ~$0.50/hr |
| **A100 (80 GB)** | 80 GB | All 4 models, larger context windows | ~$1.10/hr |
| **2× A6000** | 96 GB | All 4 + DeepSeek V4 Flash (Q4) | ~$1.00/hr |

Ollama loads one model at a time into VRAM by default (configurable with `OLLAMA_NUM_PARALLEL`). A single A6000 handles all four models — it just swaps between them.

### Pod Settings

- **Template:** RunPod Pytorch 2.x (or any Ubuntu 22.04+ image)
- **Container Disk:** 20 GB minimum
- **Volume Disk:** 100 GB (models are stored here)
- **Volume Mount Path:** `/workspace`
- **Expose HTTP Ports:** `5000, 3000, 11434`

---

## 2. Quick Start (One Script)

SSH into your pod or open the Web Terminal and run:

```bash
curl -sL https://raw.githubusercontent.com/YOUR_REPO/main/runpod-setup.sh | bash
```

Or upload the `runpod-setup.sh` script from this repo and run:

```bash
chmod +x runpod-setup.sh
./runpod-setup.sh
```

The script handles everything: Ollama install, model pulls, Python deps, Node.js, and starting all services.

---

## 3. Manual Setup (Step by Step)

### 3.1 Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Start the server:

```bash
OLLAMA_HOST=0.0.0.0 ollama serve &
```

Setting `OLLAMA_HOST=0.0.0.0` allows connections from the Flask backend (important inside containers).

### 3.2 Pull Models

```bash
ollama pull gemma4
ollama pull qwen3:32b
ollama pull deepseek-coder
ollama pull deepseek-r1:32b
```

Each pull can take 5–15 minutes depending on network speed. You can check progress with `ollama list` after each pull.

### 3.3 Install Python Backend

```bash
cd /workspace
git clone https://github.com/YOUR_REPO/supafantastic-llm.git
cd supafantastic-llm

pip install flask flask-cors requests gunicorn
```

Start the backend:

```bash
python app.py &
```

Or for production:

```bash
gunicorn -w 2 -b 0.0.0.0:5000 app:app &
```

### 3.4 Install Frontend

```bash
# Install Node.js if not present
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

cd /workspace/supafantastic-llm/frontend
npm install
```

For development:

```bash
PORT=3000 HOST=0.0.0.0 npm start &
```

For production:

```bash
npm run build
npx serve -s build -l 3000 &
```

---

## 4. Connecting from SupaFantastic UI

### Local Machine → RunPod Pod

If you want to run the React frontend locally and point it at the RunPod backend:

1. In RunPod, expose port `5000` as an HTTP service
2. Your pod gets a URL like `https://YOUR_POD_ID-5000.proxy.runpod.net`
3. In your local `App.js`, change the backend URL:

```js
// Replace all instances of "http://localhost:5000" with your RunPod proxy URL
const BACKEND_URL = "https://YOUR_POD_ID-5000.proxy.runpod.net";
```

### Using the Modes Panel (Recommended)

The UI has a built-in RunPod mode under Settings → Modes:

1. Enter your RunPod **API Key** (get it from runpod.io → Settings → API Keys)
2. Enter your **Pod ID** (visible in the pod URL or pod list)
3. Toggle **RunPod Mode** on
4. Use the Start/Stop buttons in the header to control the pod
5. Enable **Auto-timeout** to stop the pod after inactivity (saves money)

---

## 5. Ollama Configuration Tips

### Increase Context Window

The default context is 2048 tokens. For serious use, increase it:

```bash
# Set environment variable before starting Ollama
export OLLAMA_NUM_CTX=8192
```

Or per-request, your backend can pass `"options": {"num_ctx": 8192}` in the generate call.

### Keep Models Loaded

By default Ollama unloads models after 5 minutes of inactivity. To keep them warm:

```bash
export OLLAMA_KEEP_ALIVE=-1   # never unload
```

### GPU Layer Offloading

Ollama auto-detects GPUs. To verify:

```bash
ollama ps           # shows loaded models and GPU layers
nvidia-smi          # shows VRAM usage
```

---

## 6. Persistence Across Restarts

RunPod volumes persist at `/workspace`. The setup script stores everything there:

```
/workspace/
├── ollama_models/          # Symlinked from ~/.ollama/models
├── supafantastic-llm/      # Your app code
│   ├── app.py              # Flask backend
│   ├── frontend/           # React app
│   └── requirements.txt
└── runpod-setup.sh
```

Models survive pod restarts as long as you keep the volume. The setup script checks for existing models and skips downloads.

---

## 7. Troubleshooting

**"Model not found" after restart**
Ollama's model directory resets if not symlinked to `/workspace`. The setup script handles this, but if you installed manually:

```bash
mkdir -p /workspace/ollama_models
ln -sf /workspace/ollama_models ~/.ollama/models
```

**Slow inference (CPU offloading)**
Check that GPU layers are being used:

```bash
ollama ps
```

If you see `0/XX layers offloaded`, your CUDA drivers may need updating:

```bash
nvidia-smi   # should show your GPU
```

**Port not accessible**
RunPod requires explicit port exposure. In your pod settings, add `3000` and `5000` to the exposed HTTP ports list.

**Out of VRAM**
Ollama auto-unloads the previous model when you switch. If you're running out of VRAM, reduce the context window or use a smaller model variant.

---

## 8. Cost Optimization

- **Use auto-timeout** in the SupaFantastic UI (Settings → Modes → RunPod → Auto-timeout)
- **Use Community Cloud** instead of Secure Cloud (30–50% cheaper)
- **Spot instances** are cheapest but can be preempted
- **Stop the pod** when not in use — you only pay for volume storage (~$0.10/GB/month)
- A 100 GB volume costs about $10/month to keep your models cached