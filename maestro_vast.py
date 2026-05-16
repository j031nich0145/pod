#!/usr/bin/env python3
"""
maestro_vast.py — Vast.ai lifecycle for SupaFantastic
=======================================================
Fresh Docker instance every session. vllm/vllm-openai:latest has vLLM
pre-installed; only model download needed (~12-15 min).

Commands:
    python3 ~/pod/maestro_vast.py start [--model qwen-coder|deepseek-r1]
    python3 ~/pod/maestro_vast.py stop
    python3 ~/pod/maestro_vast.py terminate
    python3 ~/pod/maestro_vast.py status
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys, time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import requests

# ── paths ─────────────────────────────────────────────────────────────────────
POD_DIR  = Path.home() / "pod"
CONFIG   = POD_DIR / "supa_config.env"
SSH_KEY  = Path.home() / ".ssh" / "pod_key"

# ── constants ─────────────────────────────────────────────────────────────────
VAST_API     = "https://console.vast.ai/api/v0"
DOCKER_IMAGE = "vllm/vllm-openai:latest"
DISK_GB      = 80

SEARCH_FILTER = {
    "gpu_ram":       {"gte": 24000},
    "num_gpus":      {"eq": 1},
    "reliability":   {"gte": 0.95},
    "disk_space":    {"gte": DISK_GB},
    "rentable":      {"eq": True},
    "cuda_max_good": {"gte": 12.0},
}

MODELS: Dict[str, Dict] = {
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

# Timeouts — generous because Docker image pull is ~20GB
ALLOC_STUCK_S  = 5 * 60    # if still "created" after this → bad host, retry
SSH_TIMEOUT_S  = 30 * 60
VLLM_TIMEOUT_S = 25 * 60

MAX_OFFER_RETRIES = 5       # try up to 5 different hosts before giving up

# ETA guidance shown in log
PHASE_ETA = {
    "created":   "allocating host... (0-2 min)",
    "loading":   "pulling Docker image ~20GB... (10-20 min — please wait)",
    "running":   "container up, probing SSH...",
}

_JSON_EVENTS = False


# ── logging ───────────────────────────────────────────────────────────────────
def log(msg: str = "") -> None: print(msg, flush=True)
def event(name: str, **kw: Any) -> None:
    if _JSON_EVENTS:
        print(json.dumps({"event": name, "ts": round(time.time(),2), **kw}), flush=True)
def die(msg: str) -> None: log(f"ERROR: {msg}"); sys.exit(1)


# ── config ────────────────────────────────────────────────────────────────────
def load_env() -> Dict[str, str]:
    if not CONFIG.exists(): die(f"Config missing: {CONFIG}")
    env: Dict[str, str] = {}
    for line in CONFIG.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("\"'")
    return env

def save_env(env: Dict[str, str]) -> None:
    lines, seen = [], set()
    if CONFIG.exists():
        for line in CONFIG.read_text().splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                lines.append(line); continue
            k = raw.split("=",1)[0].strip()
            if k in env and k not in seen:
                lines.append(f'{k}="{env[k]}"'); seen.add(k)
            else:
                lines.append(line)
    for k, v in env.items():
        if k not in seen: lines.append(f'{k}="{v}"')
    CONFIG.write_text("\n".join(lines) + "\n")
    try: CONFIG.chmod(0o600)
    except OSError: pass


# ── vast api ──────────────────────────────────────────────────────────────────
def _h(key: str) -> Dict: return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

def vast_get(key: str, path: str, params: Optional[Dict]=None) -> Any:
    r = requests.get(f"{VAST_API}{path}", headers=_h(key), params=params or {}, timeout=30)
    if not r.ok: raise RuntimeError(f"GET {path} → {r.status_code}: {r.text[:200]}")
    return r.json()

def vast_put(key: str, path: str, body: Dict) -> Any:
    r = requests.put(f"{VAST_API}{path}", headers=_h(key), json=body, timeout=30)
    if not r.ok: raise RuntimeError(f"PUT {path} → {r.status_code}: {r.text[:300]}")
    return r.json()

def vast_delete(key: str, path: str) -> Any:
    r = requests.delete(f"{VAST_API}{path}", headers=_h(key), timeout=30)
    if not r.ok: raise RuntimeError(f"DELETE {path} → {r.status_code}: {r.text[:200]}")
    return r.json()

def search_offers(key: str) -> List[Dict]:
    data = vast_get(key, "/bundles/", params={"q": json.dumps(SEARCH_FILTER)})
    return sorted(data.get("offers", []), key=lambda o: o.get("dph_total") or 999)

def get_my_instances(key: str) -> List[Dict]:
    return vast_get(key, "/instances/", params={"owner": "me"}).get("instances", [])

def get_instance(key: str, iid: int) -> Optional[Dict]:
    return next((i for i in get_my_instances(key) if i["id"] == iid), None)

def destroy_instance(key: str, iid: int) -> None:
    try: vast_delete(key, f"/instances/{iid}/")
    except Exception as e: log(f"  (destroy warning: {e})")


def create_instance(key: str, offer_id: int, model_cfg: Dict, hf_token: str) -> Dict:
    hf_repo = model_cfg["hf_repo"]
    served  = model_cfg["served_name"]
    args    = model_cfg["vllm_args"]
    env     = {"-p 8000:8000": "1", "HF_HOME": "/workspace/hf"}
    if hf_token: env["HF_TOKEN"] = hf_token

    onstart = (
        "set -e; mkdir -p /workspace/models /workspace/hf /workspace/logs; "
        f"echo '[vast] Downloading {hf_repo}...'; "
        f"python3 -c \""
        f"from huggingface_hub import snapshot_download; "
        f"snapshot_download(repo_id='{hf_repo}', local_dir='/workspace/models/{served}', local_dir_use_symlinks=False)"
        f"\"; "
        f"echo '[vast] Starting vLLM...'; "
        f"python3 -m vllm.entrypoints.openai.api_server "
        f"--model /workspace/models/{served} --served-model-name {served} "
        f"--host 0.0.0.0 --port 8000 {args} "
        f">> /workspace/logs/vllm.log 2>&1"
    )
    return vast_put(key, f"/asks/{offer_id}/", {
        "image": DOCKER_IMAGE, "disk": float(DISK_GB),
        "runtype": "ssh_direct", "env": env,
        "onstart": onstart, "label": f"supafantastic-{served}",
    })


# ── ssh ───────────────────────────────────────────────────────────────────────
def ssh_probe(host: str, port: int) -> bool:
    r = subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
         "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "IdentitiesOnly=yes",
         "-i", str(SSH_KEY), f"root@{host}", "-p", str(port), "echo pod_ok"],
        capture_output=True, text=True,
    )
    return "pod_ok" in r.stdout


def wait_for_ssh(key: str, iid: int) -> Tuple[str, int]:
    """
    Wait for SSH. Detects stuck 'created' hosts (bad CDI/GPU driver) and
    signals failure so the caller can retry with a different offer.
    """
    deadline    = time.time() + SSH_TIMEOUT_S
    start       = time.time()
    last_status = ""
    status_since: Dict[str, float] = {}
    ssh_host    = ""
    ssh_port    = 22

    while time.time() < deadline:
        elapsed = int(time.time() - start)
        inst = get_instance(key, iid)
        if inst:
            status   = inst.get("actual_status", "?")
            ssh_host = inst.get("ssh_host") or inst.get("public_ipaddr", "") or ssh_host
            ssh_port = int(inst.get("ssh_port") or ssh_port)

            if status != last_status:
                status_since[status] = time.time()
                last_status = status

            phase = PHASE_ETA.get(status, f"status={status}")
            log(f"  [{elapsed}s] {phase}  ssh={ssh_host}:{ssh_port}")
            event("wait_ssh_poll", status=status, host=ssh_host, port=ssh_port, elapsed=elapsed)

            # ── Bad host detection ────────────────────────────────
            # If stuck in 'created' for >ALLOC_STUCK_S, the host's GPU/CDI is broken.
            # Common error: "unresolvable CDI devices" — Docker can't access the GPU.
            if status in ("created", "allocating", "exited"):
                since = time.time() - status_since.get(status, time.time())
                if since > ALLOC_STUCK_S:
                    log(f"  ⚠ Stuck in '{status}' for {int(since//60)}m — bad host (GPU/CDI error)")
                    log(f"  Terminating instance {iid} and trying a different offer...")
                    event("host_bad", iid=iid, status=status, stuck_s=int(since))
                    destroy_instance(key, iid)
                    return "", 0   # signal: retry with next offer

            # Probe SSH regardless of reported status
            if ssh_host and ssh_port:
                if ssh_probe(ssh_host, ssh_port):
                    return ssh_host, ssh_port

        time.sleep(15)

    die(f"SSH not ready after {SSH_TIMEOUT_S//60} min")
    return "", 0


def wait_for_vllm(host: str, port: int, iid: int) -> None:
    log("Waiting for vLLM...")
    log(f"  ETA: ~12-15 min for model download + ~2 min warmup")
    log(f"  Live log: ssh -i {SSH_KEY} root@{host} -p {port} 'tail -f /workspace/logs/vllm.log'")
    event("wait_vllm_begin", iid=iid)

    deadline = time.time() + VLLM_TIMEOUT_S
    start    = time.time()

    while time.time() < deadline:
        elapsed = int(time.time() - start)

        probe = subprocess.run(
            ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
             "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "IdentitiesOnly=yes",
             "-i", str(SSH_KEY), f"root@{host}", "-p", str(port),
             "curl -fsS http://localhost:8000/v1/models 2>/dev/null && echo vllm_ok || "
             "tail -3 /workspace/logs/vllm.log 2>/dev/null || echo waiting"],
            capture_output=True, text=True, timeout=20,
        )
        out = probe.stdout.strip()
        if "vllm_ok" in out:
            log(f"✅ vLLM ready! ({elapsed}s = {elapsed//60}m {elapsed%60}s)")
            event("vllm_ready", elapsed_s=elapsed)
            return

        # Estimate progress
        eta_remaining = max(0, (12*60) - elapsed)
        eta_str = f"~{eta_remaining//60}m remaining" if eta_remaining > 60 else "almost ready..."
        for line in out.splitlines()[-2:]:
            if line.strip(): log(f"  [{elapsed}s / {eta_str}] {line.strip()}")
        if not out.strip(): log(f"  [{elapsed}s / {eta_str}] waiting...")
        time.sleep(20)

    die(f"vLLM did not become ready within {VLLM_TIMEOUT_S//60} min")


# ── commands ──────────────────────────────────────────────────────────────────
def cmd_start(env: Dict, model: str, json_events: bool = False) -> None:
    global _JSON_EVENTS
    _JSON_EVENTS = json_events

    api_key  = env.get("VAST_API_KEY","").strip()
    hf_token = env.get("HF_TOKEN","").strip()
    if not api_key: die("VAST_API_KEY missing from supa_config.env")
    if not SSH_KEY.exists():
        die(f"SSH key not found: {SSH_KEY}\n"
            f"Generate: ssh-keygen -t ed25519 -f {SSH_KEY} -N ''")

    model_cfg = MODELS.get(model)
    if not model_cfg: die(f"Unknown model '{model}'. Valid: {list(MODELS)}")

    log("🌐 SupaFantastic — Vast.ai")
    log(f"  Model:  {model_cfg['label']}")
    log(f"  Image:  {DOCKER_IMAGE}")
    log()
    event("start_begin", model=model)

    log("Searching for available GPUs...")
    offers = search_offers(api_key)
    if not offers: die("No offers found. Try again in a few minutes.")

    log(f"Found {len(offers)} offers. Top 5:")
    for o in offers[:5]:
        vram  = (o.get("gpu_ram") or 0) // 1024
        price = o.get("dph_total", 0)
        log(f"  [{o['id']}] {o.get('gpu_name','?')} {vram}GB  ${price:.3f}/hr  {o.get('geolocation','?')}")

    # Retry loop — try multiple offers in case of bad hosts
    iid: Optional[int] = None
    ssh_host = ""
    ssh_port = 22

    for attempt, offer in enumerate(offers[:MAX_OFFER_RETRIES], 1):
        gpu   = offer.get("gpu_name","?")
        vram  = (offer.get("gpu_ram") or 0) // 1024
        price = offer.get("dph_total", 0)
        loc   = offer.get("geolocation","?")

        log()
        log(f"[Attempt {attempt}/{MAX_OFFER_RETRIES}] {gpu} {vram}GB @ ${price:.3f}/hr  {loc}")
        event("offer_selected", offer_id=offer["id"], gpu=gpu, vram=vram, price=price, location=loc)
        event("create_begin", offer_id=offer["id"])

        try:
            result = create_instance(api_key, offer["id"], model_cfg, hf_token)
        except Exception as e:
            log(f"  Create failed: {e}")
            continue

        _iid = result.get("new_contract") or result.get("id")
        if not _iid:
            log(f"  No instance ID returned: {result}")
            continue

        _iid = int(_iid)
        log(f"  Instance created: {_iid}")
        event("create_success", instance_id=_iid)

        env["VAST_INSTANCE_ID"] = str(_iid)
        env["ACTIVE_MODEL"]     = model
        env["PROVIDER"]         = "vast"
        save_env(env)

        log("  Waiting for SSH (Docker image pull ~20GB happens now)...")
        event("wait_ssh", instance_id=_iid)
        _host, _port = wait_for_ssh(api_key, _iid)

        if not _host:
            log(f"  Host failed — trying next offer...")
            continue  # bad host, retry

        iid      = _iid
        ssh_host = _host
        ssh_port = _port
        break

    if not iid or not ssh_host:
        die(f"All {MAX_OFFER_RETRIES} offers failed. Try again later.")

    log(f"SSH ready: {ssh_host}:{ssh_port}")
    event("ssh_ready", host=ssh_host, port=ssh_port)
    env["VAST_SSH_HOST"] = ssh_host
    env["VAST_SSH_PORT"] = str(ssh_port)
    save_env(env)

    log()
    event("stack_begin", instance_id=iid)
    wait_for_vllm(ssh_host, ssh_port, iid)

    env["VAST_VLLM_URL"] = "http://localhost:8001"
    save_env(env)

    log()
    log("╔══════════════════════════════════════════╗")
    log("║  ✅ SupaFantastic ready (Vast.ai)        ║")
    log("╚══════════════════════════════════════════╝")
    log(f"  Instance: {iid}  |  SSH: root@{ssh_host} -p {ssh_port}")
    event("stack_ready", instance_id=iid, model=model, ssh_host=ssh_host, ssh_port=ssh_port)
    event("start_done", instance_id=iid)


def cmd_stop(env: Dict) -> None:
    api_key = env.get("VAST_API_KEY","").strip()
    iid_str = env.get("VAST_INSTANCE_ID","").strip()
    if not api_key: die("VAST_API_KEY missing")
    if not iid_str: die("VAST_INSTANCE_ID missing")
    log(f"Terminating Vast.ai instance {iid_str}...")
    destroy_instance(api_key, int(iid_str))
    for k in ("VAST_INSTANCE_ID","VAST_SSH_HOST","VAST_SSH_PORT","VAST_VLLM_URL"):
        env[k] = ""
    env["PROVIDER"] = ""
    save_env(env)
    event("stop_done", instance_id=iid_str)
    log("Done.")

def cmd_terminate(env: Dict) -> None: cmd_stop(env)

def cmd_status(env: Dict) -> None:
    api_key = env.get("VAST_API_KEY","").strip()
    if not api_key: die("VAST_API_KEY missing")
    active = env.get("VAST_INSTANCE_ID","").strip()
    for inst in get_my_instances(api_key):
        mark = " ← active" if str(inst.get("id")) == active else ""
        log(f"  {inst['id']}  {inst.get('gpu_name','?')}  [{inst.get('actual_status','?')}]  ${inst.get('dph_total',0):.3f}/hr{mark}")


# ── cli ───────────────────────────────────────────────────────────────────────
def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    start = sub.add_parser("start")
    start.add_argument("--model",       default=DEFAULT_MODEL, choices=list(MODELS))
    start.add_argument("--json-events", action="store_true")
    sub.add_parser("stop"); sub.add_parser("terminate"); sub.add_parser("status")
    args = p.parse_args()
    env  = load_env()
    if   args.command == "start":     cmd_start(env, args.model, json_events=args.json_events)
    elif args.command in ("stop","terminate"): cmd_stop(env)
    elif args.command == "status":    cmd_status(env)

if __name__ == "__main__": main()