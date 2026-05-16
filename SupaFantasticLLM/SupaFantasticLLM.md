# SupaFantasticLLM — Clean Build Guide (RunPod + Ollama)

## 🧠 Philosophy

* Keep infra **boring and predictable**
* Everything important lives in `/workspace`
* No hacks, no injected JS, no fragile SSH tricks
* One command to start everything

---

# 🧱 ARCHITECTURE

RunPod Pod (RTX GPU)
│
├── /workspace  (PERSISTENT)
│   ├── ollama/        ← models
│   ├── app/           ← your backend + UI
│   ├── scripts/       ← startup scripts
│
├── Ollama (port 11434)
└── Your App (Flask → later React)

---

# 🚀 STEP 1 — CREATE POD (CRITICAL)

In RunPod:

### MUST HAVE:

* GPU: RTX 4090 (or similar)
* Container: default PyTorch image
* ✅ **Network Volume ATTACHED**
* Mount Path:

  ```
  /workspace
  ```
* Size:

  ```
  50–100 GB
  ```

⚠️ If you skip this → EVERYTHING breaks

---

# 🔌 STEP 2 — CONNECT

Use stable SSH:

```
ssh <pod-id>@ssh.runpod.io -i ~/.ssh/id_ed25519
```

---

# 📦 STEP 3 — BASE SETUP

Inside pod:

```
apt update
apt install -y python3-venv curl
```

---

# 🧠 STEP 4 — INSTALL OLLAMA

```
curl -fsSL https://ollama.com/install.sh | sh
```

Set model storage:

```
export OLLAMA_MODELS=/workspace/ollama
```

Persist it:

```
echo 'export OLLAMA_MODELS=/workspace/ollama' >> ~/.bashrc
```

---

# 🧪 STEP 5 — TEST OLLAMA

```
ollama serve &
ollama pull qwen:7b
ollama run qwen:7b
```

---

# 🐍 STEP 6 — CREATE CLEAN PYTHON ENV

```
python3 -m venv /workspace/venv
source /workspace/venv/bin/activate
```

---

# 📦 STEP 7 — INSTALL BACKEND DEPS

```
pip install flask requests
```

---

# 📁 STEP 8 — PROJECT STRUCTURE

```
/workspace
  ├── app/
  │     ├── backend/
  │     │     app.py
  │     └── frontend/ (later)
  ├── scripts/
  │     sfgo.sh
  │     sfstop.sh
  ├── venv/
  └── ollama/
```

---

# 🧠 STEP 9 — BASIC BACKEND

Create:

```
nano /workspace/app/backend/app.py
```

```python
from flask import Flask, jsonify
import os

app = Flask(__name__)

@app.route("/")
def home():
    return {"status": "ok"}

@app.route("/start")
def start():
    os.system("nohup ollama serve &")
    return {"started": True}

@app.route("/stop")
def stop():
    os.system("pkill ollama")
    return {"stopped": True}

app.run(host="0.0.0.0", port=5000)
```

---

# 🚀 STEP 10 — START SCRIPT (CORE)

Create:

```
nano /workspace/scripts/sfgo.sh
```

```bash
#!/bin/bash

echo "🚀 SupaFantasticLLM starting..."

export OLLAMA_MODELS=/workspace/ollama

# activate env
source /workspace/venv/bin/activate

# kill old processes
pkill ollama 2>/dev/null
pkill -f app.py 2>/dev/null

sleep 1

# start ollama
echo "🧠 Starting Ollama..."
nohup ollama serve > /workspace/ollama.log 2>&1 &

sleep 3

# start backend
echo "🌐 Starting backend..."
nohup /workspace/venv/bin/python /workspace/app/backend/app.py > /workspace/app.log 2>&1 &

echo "✅ Ready"
```

Make executable:

```
chmod +x /workspace/scripts/sfgo.sh
```

---

# 🛑 STEP 11 — STOP SCRIPT

```
nano /workspace/scripts/sfstop.sh
```

```bash
#!/bin/bash

echo "🛑 Stopping services..."

pkill ollama
pkill -f app.py

echo "Done"
```

---

# 🔁 STEP 12 — WORKFLOW

Every time you start pod:

```
sfssh
/workspace/scripts/sfgo.sh
```

---

# 🌐 STEP 13 — ACCESS

Expose port:

```
5000
```

Open:

```
https://<pod-id>-5000.proxy.runpod.net
```

---

# 💸 COST CONTROL

You MUST:

* Stop pod when not in use
* Or implement idle shutdown later

---

# ⚠️ PITFALLS (LEARNED TODAY)

❌ No volume → total data loss
❌ Mixing Python envs → broken installs
❌ SSH parsing tricks → unreliable
❌ Injecting UI → fragile

---

# ✅ FINAL STATE

You now have:

* Persistent LLM server
* Clean backend control
* Reproducible startup
* No hacks

---

# 🚀 NEXT PHASE

* Build frontend (React)
* Add idle timeout
* Add RunPod API control
* Add model switching UI

---

END
