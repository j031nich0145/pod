#!/usr/bin/env python3
"""
maestro_runpod.py — RunPod lifecycle for SupaFantastic
=======================================================
Fresh Docker instance every session. Uses vllm/vllm-openai:latest so vLLM is
pre-installed; only model download needed (~12-15 min on first boot).
No persistent volumes, no templates, no DC lock. Global GPU search.

Commands:
    python3 ~/runpod/maestro_runpod.py start [--model qwen-coder|deepseek-r1]
    python3 ~/runpod/maestro_runpod.py stop
    python3 ~/runpod/maestro_runpod.py terminate
    python3 ~/runpod/maestro_runpod.py status
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

# ─────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────

GRAPHQL_URL  = "https://api.runpod.io/graphql"
CONFIG       = Path.home() / "pod" / "supa_config.env"
SSH_KEY      = Path.home() / ".ssh" / "pod_key"

DOCKER_IMAGE     = "vllm/vllm-openai:latest"
DISK_GB          = 80
MIN_MEMORY_GB    = 50    # system RAM minimum
MIN_VCPU         = 4

# GPU priority order — cheapest viable 24GB+ first (from scout data)
GPU_OPTIONS = [
    "NVIDIA RTX A5000",                 # $0.16  24GB — best value
    "NVIDIA GeForce RTX 3090",          # $0.22  24GB
    "NVIDIA GeForce RTX 3090 Ti",       # $0.27  24GB
    "NVIDIA RTX A6000",                 # $0.33  48GB
    "NVIDIA GeForce RTX 4090",          # $0.34  24GB
    "NVIDIA RTX PRO 4500 Blackwell",    # $0.34  32GB
    "NVIDIA A40",                       # $0.35  48GB
    "NVIDIA L4",                        # $0.44  24GB
    "NVIDIA RTX 5000 Ada Generation",   # $0.49  32GB
    "NVIDIA RTX 6000 Ada Generation",   # $0.74  48GB
    "NVIDIA L40",                       # $0.69  48GB
    "NVIDIA GeForce RTX 5090",          # $0.69  32GB
    "NVIDIA L40S",                      # $0.79  48GB
]
CLOUD_OPTIONS = ["COMMUNITY", "SECURE"]

MODELS: Dict[str, Dict[str, Any]] = {
    "qwen-coder": {
        "label":       "Qwen2.5-Coder-32B (AWQ)",
        "hf_repo":     "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
        "served_name": "qwen-coder",
        "vllm_args":   "--gpu-memory-utilization 0.92 --max-model-len 8192 --enforce-eager",
    },
    "deepseek-r1": {
        "label":       "DeepSeek-R1-Distill-Qwen-32B (AWQ)",
        "hf_repo":     "Valdemardi/DeepSeek-R1-Distill-Qwen-32B-AWQ",
        "served_name": "deepseek-r1",
        "vllm_args":   "--gpu-memory-utilization 0.92 --max-model-len 8192 --enforce-eager",
    },
}
DEFAULT_MODEL = "qwen-coder"

PORTS_TIMEOUT_S = 5 * 60
SSH_TIMEOUT_S   = 30 * 60   # Docker image pull (~20GB) takes 10-20 min on cold host
VLLM_TIMEOUT_S  = 25 * 60

_JSON_EVENTS = False


# ─────────────────────────────────────
# LOGGING
# ─────────────────────────────────────

def log(msg: str = "") -> None:
    print(msg, flush=True)

def event(name: str, **fields: Any) -> None:
    if _JSON_EVENTS:
        print(json.dumps({"event": name, "ts": round(time.time(), 2), **fields}), flush=True)

def die(msg: str, code: int = 1) -> None:
    log(f"ERROR: {msg}")
    sys.exit(code)


# ─────────────────────────────────────
# CONFIG
# ─────────────────────────────────────

def load_env() -> Dict[str, str]:
    if not CONFIG.exists():
        die(f"Config missing: {CONFIG}")
    env: Dict[str, str] = {}
    for line in CONFIG.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("\"'")
    return env

def save_env(env: Dict[str, str]) -> None:
    lines: list[str] = []
    seen: set[str] = set()
    if CONFIG.exists():
        for line in CONFIG.read_text().splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                lines.append(line); continue
            k = raw.split("=", 1)[0].strip()
            if k in env and k not in seen:
                lines.append(f'{k}="{env[k]}"'); seen.add(k)
            else:
                lines.append(line)
    for k, v in env.items():
        if k not in seen:
            lines.append(f'{k}="{v}"')
    CONFIG.write_text("\n".join(lines) + "\n")
    try: CONFIG.chmod(0o600)
    except OSError: pass


# ─────────────────────────────────────
# RUNPOD GRAPHQL
# ─────────────────────────────────────

def gql(api_key: str, query: str, variables: Optional[Dict] = None) -> Dict[str, Any]:
    r = requests.post(
        f"{GRAPHQL_URL}?api_key={api_key}",
        json={"query": query, "variables": variables or {}},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if "errors" in data:
        msgs = [e.get("message", str(e)) for e in data["errors"]]
        raise RuntimeError("; ".join(msgs))
    return data


CREATE_MUTATION = """
mutation CreatePod($input: PodFindAndDeployOnDemandInput!) {
  podFindAndDeployOnDemand(input: $input) {
    id
    desiredStatus
    imageName
    machine { podHostId }
  }
}
"""

POD_STATUS_QUERY = """
query PodStatus($podId: String!) {
  pod(input: {podId: $podId}) {
    id
    desiredStatus
    machine { podHostId }
    runtime {
      uptimeInSeconds
      ports {
        ip
        isIpPublic
        privatePort
        publicPort
        type
      }
    }
  }
}
"""

STOP_MUTATION      = 'mutation { podStop(input: {podId: "%s"}) { id desiredStatus } }'
TERMINATE_MUTATION = 'mutation { podTerminate(input: {podId: "%s"}) }'


def create_pod(api_key: str, gpu: str, cloud: str, ssh_pub: str) -> Optional[Dict]:
    """
    Attempt to create a pod with the given GPU on RunPod.
    Returns pod data dict on success, None if SUPPLY_CONSTRAINT.
    Raises on other errors.
    """
    variables = {
        "input": {
            "gpuTypeId":        gpu,
            "gpuCount":         1,
            "containerDiskInGb": DISK_GB,
            "volumeInGb":       0,
            "imageName":        DOCKER_IMAGE,
            "cloudType":        cloud,
            "startSsh":         True,
            "minMemoryInGb":    MIN_MEMORY_GB,
            "minVcpuCount":     MIN_VCPU,
            "envs": [
                {"key": "PUBLIC_KEY", "value": ssh_pub},
            ],
        }
    }
    try:
        result = gql(api_key, CREATE_MUTATION, variables)
        pod = result["data"]["podFindAndDeployOnDemand"]
        return pod if pod else None
    except RuntimeError as e:
        msg = str(e).lower()
        if "supply" in msg or "no instance" in msg or "no worker" in msg or "unavailable" in msg:
            return None   # expected — GPU unavailable, try next
        raise             # unexpected error — propagate


def get_pod(api_key: str, pod_id: str) -> Optional[Dict]:
    try:
        result = gql(api_key, POD_STATUS_QUERY, {"podId": pod_id})
        return result["data"].get("pod")
    except Exception:
        return None


def pod_ssh_info(pod: Dict) -> Tuple[Optional[str], Optional[int]]:
    """Extract SSH host and port from pod runtime ports."""
    host_id = (pod.get("machine") or {}).get("podHostId", "")
    runtime = pod.get("runtime") or {}
    ports   = runtime.get("ports") or []
    for p in ports:
        if p.get("privatePort") == 22 and p.get("isIpPublic"):
            host = p.get("ip") or (f"{host_id}.ssh.runpod.io" if host_id else None)
            port = p.get("publicPort")
            if host and port:
                return host, int(port)
    # fallback: use podHostId format
    if host_id:
        return f"{host_id}.ssh.runpod.io", 22
    return None, None


def vllm_proxy_url(pod_id: str) -> str:
    return f"https://{pod_id}-8000.proxy.runpod.net"


# ─────────────────────────────────────
# SSH
# ─────────────────────────────────────

def ssh_probe(host: str, port: int) -> bool:
    r = subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
         "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "IdentitiesOnly=yes",
         "-i", str(SSH_KEY), f"root@{host}", "-p", str(port), "echo runpod_ok"],
        capture_output=True, text=True,
    )
    return "runpod_ok" in r.stdout


def wait_for_ports(api_key: str, pod_id: str) -> Dict:
    """Wait until RunPod has mapped SSH ports and the pod is RUNNING."""
    deadline = time.time() + PORTS_TIMEOUT_S
    start    = time.time()
    attempt  = 0
    while time.time() < deadline:
        attempt += 1
        elapsed = int(time.time() - start)
        pod = get_pod(api_key, pod_id)
        if pod:
            status  = pod.get("desiredStatus", "")
            runtime = pod.get("runtime") or {}
            ports   = runtime.get("ports") or []
            has_ssh = any(p.get("privatePort") == 22 for p in ports)
            uptime  = runtime.get("uptimeInSeconds", 0)

            if status == "RUNNING" and not has_ssh:
                # Container up but ports not mapped yet — Docker image likely still pulling
                log(f"  [{elapsed}s] Container starting, awaiting port map... (Docker pull may still be in progress)")
            elif status != "RUNNING":
                log(f"  [{elapsed}s] Pod status={status} — waiting for container (Docker pull ~20GB)...")
            else:
                log(f"  [{elapsed}s] status={status}  ports={len(ports)}  ssh={has_ssh}")

            event("wait_ports_poll", status=status, ports=len(ports), ssh=has_ssh)
            if status == "RUNNING" and has_ssh:
                return pod
        time.sleep(10)
    die(f"Pod never reached RUNNING with ports after {PORTS_TIMEOUT_S // 60} min")
    return {}


def wait_for_ssh(api_key: str, pod_id: str) -> Tuple[str, int]:
    """Wait until SSH accepts connections; return (host, port)."""
    pod      = wait_for_ports(api_key, pod_id)
    host, port = pod_ssh_info(pod)
    if not host or not port:
        die("Could not determine SSH host/port from pod runtime")

    log(f"SSH target: {host}:{port}")
    deadline = time.time() + SSH_TIMEOUT_S
    attempt  = 0
    while time.time() < deadline:
        attempt += 1
        if ssh_probe(host, port):
            log(f"SSH ready ({attempt} attempts)")
            return host, port
        log(f"  [{attempt}] SSH not yet accepting connections...")
        time.sleep(10)

    die(f"SSH did not become ready after {SSH_TIMEOUT_S // 60} min")
    return "", 0


def wait_for_vllm(pod_id: str, ssh_host: str, ssh_port: int) -> None:
    proxy = vllm_proxy_url(pod_id)
    log(f"Waiting for vLLM...")
    log(f"  Phase 1: Model download from HuggingFace (~18GB, ~10-15 min)")
    log(f"  Phase 2: vLLM warmup (~2-3 min)")
    log(f"  Proxy URL: {proxy}")
    log(f"  Live log: ssh -i {SSH_KEY} root@{ssh_host} -p {ssh_port} 'tail -f /workspace/logs/vllm.log'")
    event("wait_vllm_begin", pod_id=pod_id, proxy=proxy)

    deadline   = time.time() + VLLM_TIMEOUT_S
    start      = time.time()
    MODEL_SIZE = 18.0  # AWQ-32B ~18GB

    while time.time() < deadline:
        elapsed = int(time.time() - start)

        # Try RunPod HTTPS proxy first (no tunnel needed)
        try:
            r = requests.get(f"{proxy}/v1/models", timeout=8)
            if r.status_code == 200:
                log(f"✅ vLLM ready via proxy! ({elapsed}s = {elapsed//60}m {elapsed%60}s)")
                event("vllm_ready", elapsed_s=elapsed)
                return
        except requests.RequestException:
            pass

        # SSH: check vLLM health + model download progress in one call
        cmd = (
            "VLLM_OK=$(curl -fsS http://localhost:8000/v1/models 2>/dev/null && echo ok || true); "
            "DL_GB=$(du -sh /workspace/models 2>/dev/null | awk '{print $1}' || echo 0); "
            "LOG_TAIL=$(tail -1 /workspace/logs/vllm.log 2>/dev/null || true); "
            "echo \"VLLM=$VLLM_OK|DL=$DL_GB|LOG=$LOG_TAIL\""
        )
        probe = subprocess.run(
            ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
             "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "IdentitiesOnly=yes",
             "-i", str(SSH_KEY), f"root@{ssh_host}", "-p", str(ssh_port), cmd],
            capture_output=True, text=True, timeout=25,
        )
        out = probe.stdout.strip()

        if "VLLM=ok" in out:
            log(f"✅ vLLM ready! ({elapsed}s = {elapsed//60}m {elapsed%60}s)")
            event("vllm_ready", elapsed_s=elapsed)
            return

        dl_gb = log_tail = ""
        for part in out.split("|"):
            if part.startswith("DL="): dl_gb    = part[3:].strip()
            elif part.startswith("LOG="): log_tail = part[4:].strip()

        eta_remaining = max(0, int((MODEL_SIZE / 18.0) * 750) - elapsed)
        eta_str = f"~{eta_remaining//60}m remaining" if eta_remaining > 30 else "almost ready..."

        if dl_gb and dl_gb not in ("0", "0B", ""):
            try:
                size_str = dl_gb.upper()
                if "G" in size_str:
                    downloaded = float(size_str.replace("G","").replace("B","").strip())
                    pct = min(100, (downloaded / MODEL_SIZE) * 100)
                    bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
                    progress = f"Model download: {downloaded:.1f}GB / ~{MODEL_SIZE:.0f}GB [{bar}] {pct:.0f}%"
                elif "M" in size_str:
                    downloaded_mb = float(size_str.replace("M","").replace("B","").strip())
                    pct = min(100, (downloaded_mb / (MODEL_SIZE * 1024)) * 100)
                    progress = f"Model download: {downloaded_mb:.0f}MB / ~{MODEL_SIZE:.0f}GB ({pct:.1f}%)"
                else:
                    progress = f"Model download: {dl_gb} on disk"
            except (ValueError, AttributeError):
                progress = f"Model download: {dl_gb} on disk"

            if log_tail and "download" not in log_tail.lower():
                progress += f"  │  {log_tail[:50]}"
            log(f"  [{elapsed}s / {eta_str}] {progress}")
        elif log_tail:
            log(f"  [{elapsed}s / {eta_str}] {log_tail[:80]}")
        else:
            log(f"  [{elapsed}s / {eta_str}] Waiting for model download to start...")

        time.sleep(20)

    die(f"vLLM did not become ready within {VLLM_TIMEOUT_S // 60} min")


# ─────────────────────────────────────
# SETUP ON POD
# ─────────────────────────────────────

def ssh_run(host: str, port: int, cmd: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
         "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "IdentitiesOnly=yes",
         "-i", str(SSH_KEY), f"root@{host}", "-p", str(port), cmd],
        capture_output=True, text=True, timeout=timeout,
    )


def start_model_on_pod(host: str, port: int, model_cfg: Dict, hf_token: str) -> None:
    """SSH into pod and launch model download + vLLM in background."""
    hf_repo    = model_cfg["hf_repo"]
    served     = model_cfg["served_name"]
    vllm_args  = model_cfg["vllm_args"]
    token_cmd  = (f"python3 -c \"from huggingface_hub import login; login(token='{hf_token}')\" && "
                  if hf_token else "")

    script = (
        "mkdir -p /workspace/models /workspace/hf /workspace/logs; "
        f"{token_cmd}"
        f"nohup bash -c '"
        f"echo \"[runpod] Downloading {hf_repo}...\"; "
        f"python3 -c \""
        f"from huggingface_hub import snapshot_download; "
        f"snapshot_download(repo_id=\\\"{hf_repo}\\\", local_dir=\\\"/workspace/models/{served}\\\", local_dir_use_symlinks=False)"
        f"\"; "
        f"echo \"[runpod] Starting vLLM...\"; "
        f"python3 -m vllm.entrypoints.openai.api_server "
        f"--model /workspace/models/{served} "
        f"--served-model-name {served} "
        f"--host 0.0.0.0 --port 8000 "
        f"{vllm_args}"
        f"' >> /workspace/logs/vllm.log 2>&1 &"
    )

    log("Launching model download + vLLM on pod...")
    result = ssh_run(host, port, script, timeout=30)
    if result.returncode != 0:
        log(f"  stderr: {result.stderr[:200]}")


# ─────────────────────────────────────
# COMMANDS
# ─────────────────────────────────────

def cmd_start(env: Dict[str, str], model: str,
              json_events: bool = False) -> None:
    global _JSON_EVENTS
    _JSON_EVENTS = json_events

    api_key  = env.get("RUNPOD_API_KEY", "").strip()
    hf_token = env.get("HF_TOKEN", "").strip()
    if not api_key:
        die("RUNPOD_API_KEY missing from supa_config.env")
    if not SSH_KEY.exists():
        die(f"SSH key not found: {SSH_KEY}\n"
            f"Generate: ssh-keygen -t ed25519 -f {SSH_KEY} -N ''")

    model_cfg = MODELS.get(model)
    if not model_cfg:
        die(f"Unknown model '{model}'. Valid: {list(MODELS)}")

    ssh_pub = Path(f"{SSH_KEY}.pub").read_text().strip()

    log("⚡ SupaFantastic — RunPod")
    log(f"  Model:  {model_cfg['label']}")
    log(f"  Image:  {DOCKER_IMAGE}")
    log()
    event("start_begin", model=model, image=DOCKER_IMAGE)

    # ── Find and create pod ───────────────────────────────────────
    pod    = None
    pod_id = None

    for gpu in GPU_OPTIONS:
        for cloud in CLOUD_OPTIONS:
            log(f"→ Trying {gpu} [{cloud}]...")
            event("create_attempt", gpu=gpu, cloud=cloud)
            try:
                pod = create_pod(api_key, gpu, cloud, ssh_pub)
                if pod:
                    pod_id = pod["id"]
                    log(f"✓ Pod created: {pod_id}  [{gpu} / {cloud}]")
                    event("create_success", pod_id=pod_id, gpu=gpu, cloud=cloud)
                    break
                else:
                    log(f"  Unavailable")
                    event("create_unavailable", gpu=gpu, cloud=cloud, reason="SUPPLY_CONSTRAINT")
            except Exception as e:
                log(f"  Error: {e}")
                event("create_unavailable", gpu=gpu, cloud=cloud, reason=str(e))
        if pod:
            break

    if not pod or not pod_id:
        die("No GPUs available across all options. Try again later.")

    env["POD_ID"]       = pod_id
    env["ACTIVE_MODEL"] = model
    env["PROVIDER"]     = "runpod"
    save_env(env)

    # ── Wait for ports + SSH ──────────────────────────────────────
    log()
    log("Waiting for pod ports...")
    event("wait_ports", pod_id=pod_id)
    wait_for_ports(api_key, pod_id)

    log("Waiting for SSH...")
    event("wait_ssh", pod_id=pod_id)
    ssh_host, ssh_port = wait_for_ssh(api_key, pod_id)
    log(f"SSH ready: {ssh_host}:{ssh_port}")
    event("ssh_ready", host=ssh_host, port=ssh_port)

    env["SSH_HOST"] = ssh_host
    env["SSH_PORT"] = str(ssh_port)
    save_env(env)

    # ── Launch vLLM on pod ────────────────────────────────────────
    log()
    event("stack_begin", pod_id=pod_id)
    start_model_on_pod(ssh_host, ssh_port, model_cfg, hf_token)

    # ── Wait for vLLM to become ready ─────────────────────────────
    wait_for_vllm(pod_id, ssh_host, ssh_port)

    # ── Done ──────────────────────────────────────────────────────
    proxy = vllm_proxy_url(pod_id)
    env["VLLM_URL"] = proxy
    save_env(env)

    log()
    log("╔══════════════════════════════════════════╗")
    log("║  ✅ SupaFantastic ready (RunPod)         ║")
    log("╚══════════════════════════════════════════╝")
    log(f"  Pod:    {pod_id}")
    log(f"  Model:  {model_cfg['label']}")
    log(f"  API:    {proxy}")
    log(f"  SSH:    root@{ssh_host} -p {ssh_port}")
    event("stack_ready", pod_id=pod_id, model=model, proxy=proxy,
          ssh_host=ssh_host, ssh_port=ssh_port)
    event("start_done", pod_id=pod_id)


def cmd_stop(env: Dict[str, str]) -> None:
    api_key = env.get("RUNPOD_API_KEY", "").strip()
    pod_id  = env.get("POD_ID", "").strip()
    if not api_key: die("RUNPOD_API_KEY missing")
    if not pod_id:  die("POD_ID missing")
    log(f"Stopping pod {pod_id}...")
    gql(api_key, STOP_MUTATION % pod_id)
    log("Pod stopped.")
    event("stop_done", pod_id=pod_id)


def cmd_terminate(env: Dict[str, str]) -> None:
    api_key = env.get("RUNPOD_API_KEY", "").strip()
    pod_id  = env.get("POD_ID", "").strip()
    if not api_key: die("RUNPOD_API_KEY missing")
    if not pod_id:  die("POD_ID missing")
    log(f"Terminating pod {pod_id}...")
    try:
        gql(api_key, TERMINATE_MUTATION % pod_id)
    except Exception as e:
        log(f"Warning: {e}")
    for k in ("POD_ID", "SSH_HOST", "SSH_PORT", "VLLM_URL"):
        env[k] = ""
    env["PROVIDER"] = ""
    save_env(env)
    log("Pod terminated.")
    event("terminate_done", pod_id=pod_id)


def cmd_status(env: Dict[str, str]) -> None:
    api_key = env.get("RUNPOD_API_KEY", "").strip()
    pod_id  = env.get("POD_ID", "").strip()
    if not api_key: die("RUNPOD_API_KEY missing")
    if not pod_id:
        log("No active pod (POD_ID not set).")
        return
    pod = get_pod(api_key, pod_id)
    if not pod:
        log(f"Pod {pod_id} not found.")
        return
    log(f"Pod {pod_id}: {pod.get('desiredStatus','?')}")
    runtime = pod.get("runtime") or {}
    uptime  = runtime.get("uptimeInSeconds", 0)
    if uptime:
        log(f"  Uptime: {uptime // 60}m {uptime % 60}s")
    proxy = vllm_proxy_url(pod_id)
    log(f"  API proxy: {proxy}")


# ─────────────────────────────────────
# CLI
# ─────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="SupaFantastic RunPod maestro")
    sub = p.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start")
    start.add_argument("--model",       default=DEFAULT_MODEL, choices=list(MODELS))
    start.add_argument("--json-events", action="store_true")

    sub.add_parser("stop")
    sub.add_parser("terminate")
    sub.add_parser("status")

    args = p.parse_args()
    env  = load_env()

    if   args.command == "start":     cmd_start(env, args.model, json_events=args.json_events)
    elif args.command == "stop":      cmd_stop(env)
    elif args.command == "terminate": cmd_terminate(env)
    elif args.command == "status":    cmd_status(env)


if __name__ == "__main__":
    main()