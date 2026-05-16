"""
SupaFantastic Flask Backend
===========================

Thin orchestration layer between the React UI and maestro_runpod.py.

What changed vs the previous version:
- /runpod/start no longer does a naive podResume. It runs maestro_runpod.py
  start --yes-global-rebuild as a subprocess so we get the full fallback
  chain (resume -> existing-volume create across GPU x cloud -> global rebuild).
- Progress streams back to the UI via Server-Sent Events at
  /runpod/start/stream. The React Start button just opens an EventSource
  and renders log lines as they arrive.
- /runpod/config exposes the parsed supa_config.env so the UI can sync
  POD_ID / UI_URL / SSH_HOST / podRunning state after a run.
- /chat is upstream-agnostic. By default it routes to vLLM's OpenAI-style
  endpoint on the pod (via the RunPod HTTPS proxy), but if LLM_BACKEND=ollama
  it falls back to the old Ollama /api/generate format. Configurable.

This file is meant to live on your LOCAL machine (not on the pod). It needs
to be able to spawn ~/runpod/maestro_runpod.py and read ~/runpod/supa_config.env.
"""

from __future__ import annotations

import json
import os
import queue
import select
import shlex
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from flask_cors import CORS

try:
    import paramiko
    _PARAMIKO = True
except ImportError:
    _PARAMIKO = False

try:
    from flask_sock import Sock
    _FLASK_SOCK = True
except ImportError:
    _FLASK_SOCK = False

# ─────────────────────────────────────
# PATHS / CONFIG
# ─────────────────────────────────────

RUNPOD_DIR          = Path.home() / "pod"
CONFIG              = RUNPOD_DIR / "supa_config.env"
MAESTRO_SCRIPT      = RUNPOD_DIR / "maestro_runpod.py"
MAESTRO_VAST_SCRIPT = RUNPOD_DIR / "maestro_vast.py"
PYTHON_BIN          = os.environ.get("MAESTRO_PYTHON", sys.executable)

# SSH tunnel process for Vast.ai (forwards pod :8000 → local :8001)
_vast_tunnel_proc: Optional[subprocess.Popen] = None
VAST_LOCAL_PORT = 8001

# Import the model registry from maestro so there's a single source of truth.
# If maestro isn't on the path yet (first run before install), fall back to a
# minimal inline copy so the UI still loads.
try:
    sys.path.insert(0, str(RUNPOD_DIR))
    from maestro_runpod import MODELS as _MAESTRO_MODELS, DEFAULT_MODEL as _MAESTRO_DEFAULT
    MODELS = _MAESTRO_MODELS
    DEFAULT_MODEL = _MAESTRO_DEFAULT
except Exception:
    MODELS = {
        "qwen-coder": {
            "label": "Qwen2.5-Coder-32B (AWQ)",
            "served_name": "qwen-coder",
            "default_temperature": 0.2,
            "default_system_prompt": "You are a precise coding assistant.",
        },
        "deepseek-r1": {
            "label": "DeepSeek-R1-Distill-Qwen-32B (AWQ)",
            "served_name": "deepseek-r1",
            "default_temperature": 0.6,
            "default_system_prompt": None,
        },
    }
    DEFAULT_MODEL = "qwen-coder"

# If a React production build exists at this path, Flask serves it at /.
# This lets `python3 app.py` be the single entrypoint: open localhost:5000
# and you get the full UI. Override with REACT_BUILD=/some/path.
REACT_BUILD = Path(
    os.environ.get(
        "REACT_BUILD",
        str(RUNPOD_DIR / "SupaFantasticLLM" / "app" / "frontend" / "build"),
    )
)

# Where the chat handler routes requests. Two modes:
#   - "vllm"   -> OpenAI-compatible /v1/chat/completions
#   - "ollama" -> Ollama-style /api/generate
LLM_BACKEND = os.environ.get("LLM_BACKEND", "vllm").lower()

# Default upstream URL is derived from POD_ID in supa_config.env if not set.
# Override with LLM_URL=... to force a different target.
LLM_URL_OVERRIDE = os.environ.get("LLM_URL", "").strip()
LLM_PORT = int(os.environ.get("LLM_PORT", "8000"))  # vLLM=8000, Ollama=11434

REQUEST_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "300"))

app = Flask(__name__, static_folder=None)
CORS(app)
if _FLASK_SOCK:
    sock = Sock(app)

# ─────────────────────────────────────
# CONFIG FILE I/O
# ─────────────────────────────────────


def load_config() -> Dict[str, str]:
    if not CONFIG.exists():
        return {}
    env: Dict[str, str] = {}
    for line in CONFIG.read_text().splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def save_config_field(key: str, value: str) -> None:
    """Update a single field in supa_config.env, preserving the rest."""
    env = load_config()
    env[key] = value
    lines = []
    seen = set()
    if CONFIG.exists():
        for line in CONFIG.read_text().splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                lines.append(line)
                continue
            k = raw.split("=", 1)[0].strip()
            if k in env and k not in seen:
                lines.append(f'{k}="{env[k]}"')
                seen.add(k)
            else:
                lines.append(line)
    # Append any new keys
    for k, v in env.items():
        if k not in seen:
            lines.append(f'{k}="{v}"')
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text("\n".join(lines) + "\n")
    try:
        CONFIG.chmod(0o600)
    except OSError:
        pass


def llm_url() -> str:
    if LLM_URL_OVERRIDE:
        return LLM_URL_OVERRIDE.rstrip("/")
    env = load_config()
    provider = env.get("PROVIDER", "").strip()
    if provider == "vast":
        return f"http://localhost:{VAST_LOCAL_PORT}"
    pod_id = env.get("POD_ID", "").strip()
    if pod_id:
        return f"https://{pod_id}-{LLM_PORT}.proxy.runpod.net"
    return f"http://localhost:{LLM_PORT}"


# ─────────────────────────────────────
# CHAT PROXY
# ─────────────────────────────────────


def active_model_name() -> str:
    """Best-effort: read active model from config. Default to DEFAULT_MODEL."""
    env = load_config()
    return env.get("ACTIVE_MODEL") or DEFAULT_MODEL


@app.route("/chat", methods=["POST"])
def chat():
    data = request.json or {}
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400

    # Resolve which model to use. UI can override; otherwise active model.
    requested = (data.get("model") or "").strip() or active_model_name()
    cfg = MODELS.get(requested)
    if not cfg:
        return jsonify({"error": f"Unknown model '{requested}'"}), 400

    served_name = cfg.get("served_name", requested)
    temperature = float(data.get("temperature", cfg.get("default_temperature", 0.6)))
    max_tokens = int(data.get("max_tokens", 1200))

    # Build messages list. Honor per-model "no system prompt" preference
    # (DeepSeek-R1 explicitly recommends against system prompts).
    messages = []
    sys_prompt = data.get("system")
    if sys_prompt is None:
        sys_prompt = cfg.get("default_system_prompt")
    if sys_prompt:
        messages.append({"role": "system", "content": sys_prompt})
    # Allow caller to pass full message history via "messages" key.
    if isinstance(data.get("messages"), list):
        messages.extend(data["messages"])
    else:
        messages.append({"role": "user", "content": prompt})

    base = llm_url()

    # Auto-heal: if Vast.ai provider but tunnel is dead, restart it
    _cfg = load_config()
    if _cfg.get("PROVIDER", "").strip() == "vast":
        tunnel_alive = _vast_tunnel_proc is not None and _vast_tunnel_proc.poll() is None
        if not tunnel_alive:
            app.logger.info("[chat] Vast.ai tunnel dead — restarting...")
            _start_vast_tunnel()
            time.sleep(2)

    try:
        response = requests.post(
            f"{base}/v1/chat/completions",
            json={
                "model": served_name,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": False,
            },
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        text = ""
        if isinstance(payload, dict):
            choices = payload.get("choices") or []
            if choices:
                msg = (choices[0] or {}).get("message") or {}
                text = msg.get("content") or ""
        return jsonify({"response": text, "model": requested, "raw": payload})
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Upstream LLM error: {e}"}), 502


@app.route("/v1/chat/completions", methods=["POST"])
def openai_compat_chat():
    """
    OpenAI-compatible passthrough for tools that already speak the OpenAI API
    (e.g. Cursor's custom OpenAI base URL). Reroutes to the pod's vLLM via the
    RunPod proxy. The UI doesn't use this — it's here so external tools can
    point at http://localhost:5000/v1/chat/completions and get a stable URL
    that doesn't change when the pod_id rotates.
    """
    data = request.json or {}
    # If model in the request matches a UI key, translate to served_name.
    model_key = data.get("model")
    if model_key in MODELS:
        data["model"] = MODELS[model_key]["served_name"]
    elif not model_key:
        data["model"] = MODELS[active_model_name()]["served_name"]

    base = llm_url()
    try:
        response = requests.post(
            f"{base}/v1/chat/completions",
            json=data,
            timeout=REQUEST_TIMEOUT,
            stream=bool(data.get("stream")),
        )
        if data.get("stream"):
            # Pass SSE through verbatim.
            return Response(
                stream_with_context(response.iter_content(chunk_size=None)),
                content_type=response.headers.get("Content-Type", "text/event-stream"),
            )
        return (jsonify(response.json()), response.status_code)
    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 502


@app.route("/models")
def models():
    """List models the UI should show in the dropdown. Comes from the registry,
    not from the pod, so the dropdown works even when the pod is stopped."""
    out = []
    active = active_model_name()
    for key, cfg in MODELS.items():
        out.append(
            {
                "id": key,
                "label": cfg.get("label", key),
                "served_name": cfg.get("served_name", key),
                "active": (key == active),
                "provider": "vLLM",
            }
        )
    return jsonify(out)


@app.route("/v1/models")
def openai_compat_models():
    """OpenAI-style /v1/models, for Cursor compat."""
    return jsonify(
        {
            "object": "list",
            "data": [
                {"id": key, "object": "model", "owned_by": "supafantastic"}
                for key in MODELS
            ],
        }
    )


@app.route("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "llm_backend": LLM_BACKEND,
            "llm_url": llm_url(),
            "pod_id": load_config().get("POD_ID", ""),
        }
    )


# ─────────────────────────────────────
# RUNPOD ORCHESTRATION
# ─────────────────────────────────────


class MaestroJob:
    """
    Wraps a single maestro_runpod.py subprocess invocation.

    Holds a thread-safe queue of log lines so multiple SSE consumers (or
    a late-joiner that reconnects) can replay output.
    """

    def __init__(self, job_id: str, args: list[str]):
        self.job_id = job_id
        self.args = args
        self.queue: "queue.Queue[Optional[str]]" = queue.Queue()
        self.lines: list[str] = []  # historical buffer for late subscribers
        self.lock = threading.Lock()
        self.proc: Optional[subprocess.Popen] = None
        self.returncode: Optional[int] = None
        self.started_at = time.time()
        self.finished_at: Optional[float] = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def _emit(self, line: str) -> None:
        with self.lock:
            self.lines.append(line)
        self.queue.put(line)

    def _run(self) -> None:
        try:
            self._emit(json.dumps({"event": "spawn", "cmd": self.args}))
            self.proc = subprocess.Popen(
                self.args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,  # line buffered
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
            assert self.proc.stdout is not None
            for raw in self.proc.stdout:
                self._emit(raw.rstrip("\n"))
            self.returncode = self.proc.wait()
        except Exception as e:  # noqa: BLE001
            self._emit(json.dumps({"event": "error", "message": str(e)}))
            self.returncode = -1
        finally:
            self.finished_at = time.time()
            self._emit(
                json.dumps(
                    {
                        "event": "done",
                        "returncode": self.returncode,
                        "duration_s": round(
                            (self.finished_at or time.time()) - self.started_at, 1
                        ),
                    }
                )
            )
            self.queue.put(None)  # sentinel

    def snapshot(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "job_id": self.job_id,
                "args": self.args,
                "returncode": self.returncode,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "running": self.returncode is None and self.finished_at is None,
                "lines": list(self.lines),
            }


# Global job registry. One active job at a time is the expected pattern.
_jobs: Dict[str, MaestroJob] = {}
_active_job_id: Optional[str] = None
_jobs_lock = threading.Lock()


def _build_maestro_args(action: str, *, force_rebuild: bool = True,
                        model: Optional[str] = None) -> list[str]:
    if not MAESTRO_SCRIPT.exists():
        raise FileNotFoundError(f"Missing maestro script: {MAESTRO_SCRIPT}")
    args = [PYTHON_BIN, str(MAESTRO_SCRIPT), action]
    if action == "start":
        args.append("--json-events")
        if model:
            args.extend(["--model", model])
    return args


@app.route("/runpod/start", methods=["POST"])
def runpod_start():
    """
    Kick off the full start sequence as a background job.

    Body (optional):
        { "force_rebuild": true|false }   default: true
        { "model": "qwen-coder" | "deepseek-r1" }  default: ACTIVE_MODEL from config
        { "stream": true|false }          default: false
    """
    global _active_job_id

    data = request.json or {}
    force_rebuild = bool(data.get("force_rebuild", True))
    want_stream = bool(data.get("stream", False))
    model = data.get("model") or active_model_name()
    if model not in MODELS:
        return jsonify({"success": False, "error": f"Unknown model '{model}'"}), 400

    # Validate key before spawning
    env = load_config()
    if not env.get("RUNPOD_API_KEY", "").strip():
        return jsonify({
            "success": False,
            "error": "RUNPOD_API_KEY not set in ~/pod/supa_config.env — add your key and restart.",
        }), 400

    save_config_field("ACTIVE_MODEL", model)

    try:
        args = _build_maestro_args("start", force_rebuild=force_rebuild, model=model)
    except FileNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 500

    with _jobs_lock:
        if _active_job_id and _jobs.get(_active_job_id):
            existing = _jobs[_active_job_id]
            if existing.returncode is None and existing.finished_at is None:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "A start job is already running",
                            "job_id": _active_job_id,
                        }
                    ),
                    409,
                )

        job_id = f"start-{int(time.time())}"
        job = MaestroJob(job_id, args)
        _jobs[job_id] = job
        _active_job_id = job_id
        job.start()

    if not want_stream:
        return jsonify({"success": True, "job_id": job_id, "model": model})

    return _stream_response(job)


@app.route("/runpod/start/stream/<job_id>", methods=["GET"])
def runpod_start_stream(job_id: str):
    """SSE stream for an in-flight or already-finished job."""
    job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job_id"}), 404
    return _stream_response(job, replay=True)


def _stream_response(job: MaestroJob, *, replay: bool = False) -> Response:
    def generate():
        sent = 0
        if replay:
            # Replay any buffered lines first so a late-joiner gets the full log.
            with job.lock:
                for line in job.lines:
                    sent += 1
                    yield _sse_line(line)
        # Then live-tail the queue. If the job is already done and the
        # sentinel has been consumed by an earlier subscriber, the queue
        # will be empty; that's fine, we just exit.
        while True:
            try:
                line = job.queue.get(timeout=0.5)
            except queue.Empty:
                if job.returncode is not None or job.finished_at is not None:
                    if sent == 0:
                        # No replay and queue was already drained: emit a
                        # synthetic final event so the client doesn't hang.
                        yield _sse_line(
                            json.dumps(
                                {
                                    "event": "done",
                                    "returncode": job.returncode,
                                    "replayed": False,
                                }
                            )
                        )
                    return
                # heartbeat
                yield ": keep-alive\n\n"
                continue
            if line is None:
                return
            sent += 1
            yield _sse_line(line)

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


def _sse_line(line: str) -> str:
    # SSE format: data: <text>\n\n. Multi-line strings need a "data:" prefix per line.
    safe = line.replace("\r", "")
    return "".join(f"data: {chunk}\n" for chunk in safe.split("\n")) + "\n"


@app.route("/runpod/stop", methods=["POST"])
def runpod_stop():
    """
    Stop the active pod. Uses maestro_runpod.py stop so we share the
    same config / API key handling.
    """
    try:
        args = _build_maestro_args("stop")
    except FileNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 500

    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=60
        )
        success = result.returncode == 0
        return jsonify(
            {
                "success": success,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        ), (200 if success else 500)
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "stop timed out"}), 504


@app.route("/runpod/terminate", methods=["POST"])
def runpod_terminate():
    """
    Destroy the pod entirely. Network volume persists, but the container is
    gone. Next /runpod/start will create a fresh pod.
    """
    try:
        args = _build_maestro_args("terminate")
    except FileNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 500

    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=60
        )
        success = result.returncode == 0
        return jsonify(
            {
                "success": success,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        ), (200 if success else 500)
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "terminate timed out"}), 504

@app.route("/runpod/status", methods=["GET", "POST"])
def runpod_status():
    """
    Returns current local config plus a live RunPod query for the configured pod.

    GET  /runpod/status              -> use config file's API key + pod id
    POST /runpod/status { apiKey, podId }  -> use posted values (back-compat
                                             with old App.js)
    """
    env = load_config()
    if request.method == "POST":
        data = request.json or {}
        api_key = (data.get("apiKey") or env.get("RUNPOD_API_KEY") or "").strip()
        pod_id = (data.get("podId") or env.get("POD_ID") or "").strip()
    else:
        api_key = env.get("RUNPOD_API_KEY", "").strip()
        pod_id = env.get("POD_ID", "").strip()

    if not api_key:
        return jsonify({"success": False, "error": "Missing RUNPOD_API_KEY"}), 400

    query = """
    query {
      myself {
        pods {
          id name desiredStatus
          runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } }
        }
      }
    }
    """
    try:
        res = requests.post(
            f"https://api.runpod.io/graphql?api_key={api_key}",
            json={"query": query},
            timeout=15,
        )
        result = res.json()
        all_pods = (
            (result.get("data") or {}).get("myself", {}) or {}
        ).get("pods") or []
        target = next((p for p in all_pods if p.get("id") == pod_id), None)
        running = bool(
            target
            and target.get("desiredStatus") == "RUNNING"
            and (target.get("runtime") or {}).get("ports")
        )
        return jsonify(
            {
                "success": True,
                "pod_id": pod_id,
                "running": running,
                "pod": target,
                "all_pods": all_pods,
                "ui_url": env.get("UI_URL", ""),
            }
        )
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500


# ─────────────────────────────────────
# CONFIG ENDPOINTS for the React UI
# ─────────────────────────────────────


@app.route("/runpod/config", methods=["GET"])
def runpod_config_get():
    env = load_config()
    # Don't ship the API key to the client unredacted unless asked.
    redacted = bool(request.args.get("redact", "1") == "1")
    out = dict(env)
    if redacted and out.get("RUNPOD_API_KEY"):
        key = out["RUNPOD_API_KEY"]
        out["RUNPOD_API_KEY"] = (
            f"{key[:4]}...{key[-4:]}" if len(key) > 8 else "***"
        )
    if redacted and out.get("HF_TOKEN"):
        out["HF_TOKEN"] = "***"
    if redacted and out.get("GITHUB_TOKEN"):
        out["GITHUB_TOKEN"] = "***"
    return jsonify({"success": True, "config": out, "config_path": str(CONFIG)})


@app.route("/runpod/config", methods=["PATCH", "POST"])
def runpod_config_patch():
    """
    Update one or more fields in supa_config.env. Use this for the API key,
    HF token, pod id, etc. The React Settings panel can call this.
    """
    data = request.json or {}
    allowed = {
        "RUNPOD_API_KEY",
        "HF_TOKEN",
        "GITHUB_TOKEN",
        "GITHUB_USER",
        "REPO_NAME",
        "POD_ID",
        "UI_URL",
    }
    updated = []
    for k, v in data.items():
        if k in allowed and isinstance(v, str):
            save_config_field(k, v)
            updated.append(k)
    return jsonify({"success": True, "updated": updated})


@app.route("/runpod/jobs", methods=["GET"])
def runpod_jobs():
    """List recent maestro jobs for debugging."""
    return jsonify(
        {
            "active": _active_job_id,
            "jobs": [j.snapshot() for j in _jobs.values()],
        }
    )


@app.route("/runpod/jobs/<job_id>", methods=["GET"])
def runpod_job_detail(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job_id"}), 404
    return jsonify(job.snapshot())


# ─────────────────────────────────────
# ENTRY
# ─────────────────────────────────────

# ─────────────────────────────────────
# SSH TERMINAL  (WebSocket proxy)
# ─────────────────────────────────────

if _FLASK_SOCK and _PARAMIKO:
    @sock.route("/ssh/terminal")
    def ssh_terminal(ws):
        """
        WebSocket → SSH proxy. Provider-aware: reads VAST_SSH_HOST for Vast.ai,
        SSH_HOST for RunPod. Requires paramiko + flask-sock.
        """
        env      = load_config()
        provider = env.get("PROVIDER", "").strip()

        if provider == "vast":
            ssh_host     = env.get("VAST_SSH_HOST", "").strip()
            ssh_port_str = env.get("VAST_SSH_PORT", "22").strip()
        else:
            ssh_host     = env.get("SSH_HOST", "").strip()
            ssh_port_str = env.get("SSH_PORT", "22").strip()

        ssh_key_path = str(Path.home() / ".ssh" / "pod_key")

        if not ssh_host:
            ws.send(f"\r\n[ERROR] No SSH host in config for provider='{provider or 'runpod'}'. Start the backend first.\r\n")
            return

        try:
            ssh_port = int(ssh_port_str)
        except ValueError:
            ssh_port = 22

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            client.connect(
                ssh_host, port=ssh_port, username="root",
                key_filename=ssh_key_path, timeout=12, banner_timeout=12,
            )
        except Exception as e:
            ws.send(f"\r\n[SSH ERROR] {e}\r\n")
            return

        channel = client.invoke_shell(term="xterm-256color", width=220, height=50)
        channel.setblocking(False)

        dead = threading.Event()

        def recv_output():
            """Forward pod stdout → browser."""
            try:
                while not dead.is_set():
                    r, _, _ = select.select([channel], [], [], 0.05)
                    if r:
                        data = channel.recv(4096)
                        if not data:
                            break
                        try:
                            ws.send(data.decode("utf-8", errors="replace"))
                        except Exception:
                            break
            finally:
                dead.set()

        t = threading.Thread(target=recv_output, daemon=True)
        t.start()

        try:
            while not dead.is_set():
                try:
                    data = ws.receive(timeout=1)
                    if data is not None:
                        channel.send(data)
                except Exception:
                    if not dead.is_set():
                        continue
                    break
        finally:
            dead.set()
            try:
                channel.close()
            except Exception:
                pass
            client.close()


# ─────────────────────────────────────
# VAST.AI ORCHESTRATION
# ─────────────────────────────────────

def _build_vast_args(action: str, model: Optional[str] = None) -> list[str]:
    if not MAESTRO_VAST_SCRIPT.exists():
        raise FileNotFoundError(f"Missing: {MAESTRO_VAST_SCRIPT}")
    args = [PYTHON_BIN, str(MAESTRO_VAST_SCRIPT), action]
    if action == "start":
        args += ["--json-events"]
        if model:
            args += ["--model", model]
    return args


def _start_vast_tunnel() -> None:
    """Open an SSH tunnel: local:VAST_LOCAL_PORT → remote:8000."""
    global _vast_tunnel_proc
    _stop_vast_tunnel()
    env  = load_config()
    host = env.get("VAST_SSH_HOST", "").strip()
    port = env.get("VAST_SSH_PORT", "22").strip()
    key  = str(Path.home() / ".ssh" / "pod_key")
    if not host or not port:
        app.logger.warning(f"[tunnel] Missing VAST_SSH_HOST or VAST_SSH_PORT in config")
        return
    app.logger.info(f"[tunnel] Starting: localhost:{VAST_LOCAL_PORT} → {host}:{port}")
    _vast_tunnel_proc = subprocess.Popen(
        [
            "ssh", "-N", "-L", f"{VAST_LOCAL_PORT}:localhost:8000",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ServerAliveInterval=30",
            "-o", "IdentitiesOnly=yes",
            "-o", "ConnectTimeout=15",
            "-i", key, f"root@{host}", "-p", port,
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def _stop_vast_tunnel() -> None:
    global _vast_tunnel_proc
    if _vast_tunnel_proc:
        try:
            _vast_tunnel_proc.terminate()
        except Exception:
            pass
        _vast_tunnel_proc = None


@app.route("/vastai/start", methods=["POST"])
def vastai_start():
    global _active_job_id
    data         = request.json or {}
    model        = data.get("model") or active_model_name()
    want_stream  = bool(data.get("stream", False))

    if model not in MODELS:
        return jsonify({"success": False, "error": f"Unknown model '{model}'"}), 400

    # Validate key and SSH key before spawning
    env = load_config()
    vast_key = env.get("VAST_API_KEY", "").strip()
    if not vast_key:
        return jsonify({
            "success": False,
            "error": "VAST_API_KEY not set in ~/pod/supa_config.env — add your key and restart.",
        }), 400
    ssh_key = Path.home() / ".ssh" / "pod_key"
    if not ssh_key.exists():
        return jsonify({
            "success": False,
            "error": f"SSH key not found: {ssh_key}\nGenerate: ssh-keygen -t ed25519 -f {ssh_key} -N ''\nThen add {ssh_key}.pub to console.vast.ai/manage-keys/",
        }), 400

    save_config_field("ACTIVE_MODEL", model)

    try:
        args = _build_vast_args("start", model=model)
    except FileNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 500

    with _jobs_lock:
        if _active_job_id and _jobs.get(_active_job_id):
            existing = _jobs[_active_job_id]
            if existing.returncode is None and existing.finished_at is None:
                return jsonify({"success": False, "error": "A job is already running",
                                "job_id": _active_job_id}), 409

        job_id = f"vast-{int(time.time())}"
        job    = MaestroJob(job_id, args)
        _jobs[job_id] = job
        _active_job_id = job_id
        job.start()

    def _on_finish():
        job.thread.join()
        if job.returncode == 0:
            _start_vast_tunnel()

    threading.Thread(target=_on_finish, daemon=True).start()

    if not want_stream:
        return jsonify({"success": True, "job_id": job_id, "model": model, "provider": "vast"})
    return _stream_response(job)


@app.route("/vastai/start/stream/<job_id>", methods=["GET"])
def vastai_start_stream(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job_id"}), 404
    return _stream_response(job, replay=True)


@app.route("/vastai/stop", methods=["POST"])
def vastai_stop():
    _stop_vast_tunnel()
    try:
        args   = _build_vast_args("stop")
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        save_config_field("PROVIDER", "")
        return jsonify({"success": result.returncode == 0,
                        "stdout": result.stdout, "stderr": result.stderr})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/vastai/terminate", methods=["POST"])
def vastai_terminate():
    _stop_vast_tunnel()
    try:
        args   = _build_vast_args("terminate")
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        save_config_field("PROVIDER", "")
        return jsonify({"success": result.returncode == 0,
                        "stdout": result.stdout, "stderr": result.stderr})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/vastai/status", methods=["GET"])
def vastai_status():
    try:
        args   = _build_vast_args("status")
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
        env    = load_config()
        tunnel_alive = _vast_tunnel_proc is not None and _vast_tunnel_proc.poll() is None
        return jsonify({
            "success":      result.returncode == 0,
            "output":       result.stdout,
            "instance_id":  env.get("VAST_INSTANCE_ID", ""),
            "ssh_host":     env.get("VAST_SSH_HOST", ""),
            "tunnel_alive": tunnel_alive,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/vastai/tunnel", methods=["POST"])
def vastai_tunnel():
    """(Re)start the SSH tunnel if the instance is already running."""
    _start_vast_tunnel()
    alive = _vast_tunnel_proc is not None and _vast_tunnel_proc.poll() is None
    return jsonify({"success": alive, "local_port": VAST_LOCAL_PORT})


@app.route("/debug/tunnel", methods=["GET"])
def debug_tunnel():
    """Show tunnel status and config — for diagnosing connectivity issues."""
    env = load_config()
    alive = _vast_tunnel_proc is not None and _vast_tunnel_proc.poll() is None
    key_path = str(Path.home() / ".ssh" / "pod_key")
    return jsonify({
        "provider":      env.get("PROVIDER", ""),
        "vast_ssh_host": env.get("VAST_SSH_HOST", ""),
        "vast_ssh_port": env.get("VAST_SSH_PORT", ""),
        "tunnel_alive":  alive,
        "tunnel_port":   VAST_LOCAL_PORT,
        "llm_url":       llm_url(),
        "key_exists":    Path(key_path).exists(),
        "key_path":      key_path,
    })


@app.route("/backend/status", methods=["GET"])
def backend_status():
    """
    Unified status check — reads config and queries whichever provider was last active.
    Called on UI startup to detect already-running instances from previous sessions.
    """
    env      = load_config()
    provider = env.get("PROVIDER", "").strip()
    model    = env.get("ACTIVE_MODEL", "qwen-coder")

    result: Dict[str, Any] = {
        "provider":    provider or "runpod",
        "running":     False,
        "job_running": False,
        "job_id":      None,
        "instance_id": "",
        "ssh_host":    "",
        "ssh_port":    "",
        "active_model": model,
        "uptime":      "",
    }

    # Is there an active maestro job right now?
    with _jobs_lock:
        if _active_job_id and _active_job_id in _jobs:
            job = _jobs[_active_job_id]
            if job.returncode is None and job.finished_at is None:
                result["job_running"] = True
                result["job_id"]      = _active_job_id
                result["provider"]    = "vast" if "vast" in _active_job_id else "runpod"

    # Check provider-specific instance
    if provider == "vast":
        iid      = env.get("VAST_INSTANCE_ID", "").strip()
        ssh_host = env.get("VAST_SSH_HOST", "").strip()
        ssh_port = env.get("VAST_SSH_PORT", "").strip()
        api_key  = env.get("VAST_API_KEY", "").strip()

        if iid:
            result.update({"instance_id": iid, "ssh_host": ssh_host, "ssh_port": ssh_port})
            if api_key:
                try:
                    r = requests.get(
                        f"https://console.vast.ai/api/v0/instances/{iid}/",
                        headers={"Authorization": f"Bearer {api_key}"},
                        params={"owner": "me"},
                        timeout=8,
                    )
                    if r.ok:
                        instances = r.json().get("instances", [])
                        inst = next((i for i in instances if str(i.get("id")) == iid), None)
                        if inst:
                            status = inst.get("actual_status", "")
                            result["running"] = status == "running"
                            result["instance_status"] = status
                    # fallback: assume running if we have SSH info
                    if not result["running"] and ssh_host:
                        result["running"] = True
                except Exception:
                    result["running"] = bool(ssh_host and ssh_port)

        # Auto-start SSH tunnel if Vast.ai is running and tunnel is dead
        if result["running"] and provider == "vast":
            tunnel_alive = _vast_tunnel_proc is not None and _vast_tunnel_proc.poll() is None
            if not tunnel_alive:
                _start_vast_tunnel()
                result["tunnel_started"] = True

    elif provider == "runpod" or not provider:
        pod_id   = env.get("POD_ID", "").strip()
        ssh_host = env.get("SSH_HOST", "").strip()
        ssh_port = env.get("SSH_PORT", "").strip()
        api_key  = env.get("RUNPOD_API_KEY", "").strip()
        result["provider"] = "runpod"

        if pod_id:
            result.update({"instance_id": pod_id, "ssh_host": ssh_host, "ssh_port": ssh_port})
            if api_key:
                try:
                    query = f'''query {{
                      pod(input: {{podId: "{pod_id}"}}) {{
                        desiredStatus
                        runtime {{ uptimeInSeconds }}
                      }}
                    }}'''
                    r = requests.post(
                        f"https://api.runpod.io/graphql?api_key={api_key}",
                        json={"query": query}, timeout=8,
                    )
                    if r.ok:
                        pod = (r.json().get("data") or {}).get("pod") or {}
                        result["running"] = pod.get("desiredStatus") == "RUNNING"
                        uptime_s = (pod.get("runtime") or {}).get("uptimeInSeconds", 0)
                        if uptime_s:
                            h, m, s = uptime_s // 3600, (uptime_s % 3600) // 60, uptime_s % 60
                            result["uptime"] = f"{h}h {m}m" if h else f"{m}m {s}s"
                except Exception:
                    result["running"] = bool(ssh_host and ssh_port)

    return jsonify(result)


# ─────────────────────────────────────
# STATIC REACT BUILD (optional)
# ─────────────────────────────────────

if (REACT_BUILD / "index.html").exists():

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react(path: str):
        # Don't shadow API routes — Flask matches more specific routes first,
        # so this only fires for paths not handled above.
        full = REACT_BUILD / path
        if path and full.exists() and full.is_file():
            return send_from_directory(str(REACT_BUILD), path)
        return send_from_directory(str(REACT_BUILD), "index.html")

    _SERVING_REACT = True
else:
    _SERVING_REACT = False


# ─────────────────────────────────────
# ENTRY
# ─────────────────────────────────────

if __name__ == "__main__":
    print("SupaFantastic backend on :5000")
    print(f"  CONFIG         = {CONFIG}")
    print(f"  MAESTRO_SCRIPT = {MAESTRO_SCRIPT}")
    print(f"  LLM_BACKEND    = {LLM_BACKEND}")
    print(f"  LLM_URL        = {llm_url()}")
    if _SERVING_REACT:
        print(f"  REACT_BUILD    = {REACT_BUILD}  (open http://localhost:5000)")
    else:
        print(f"  REACT_BUILD    = {REACT_BUILD}  (not found; run `npm run build` "
              "in the frontend dir, or `npm start` separately)")
    # threaded=True is important so SSE streams don't block other endpoints.
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)