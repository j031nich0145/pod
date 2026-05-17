#!/usr/bin/env python3
"""
runpod_scout.py — GPU availability scout: RunPod + Vast.ai
===========================================================
Commands:
    python3 ~/pod/runpod_scout.py              # RunPod snapshot
    python3 ~/pod/runpod_scout.py --vast       # Vast.ai snapshot (no key needed)
    python3 ~/pod/runpod_scout.py --both       # RunPod + Vast.ai side-by-side
    python3 ~/pod/runpod_scout.py --poll 30    # Poll RunPod every 30 min
    python3 ~/pod/runpod_scout.py --report     # Accumulated availability report
    python3 ~/pod/runpod_scout.py --probe-dcs  # Test per-DC availability (creates+destroys pods)
    python3 ~/pod/runpod_scout.py --clear      # Wipe history
"""

from __future__ import annotations
import argparse, json, os, sys, time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests

# ── Targets ───────────────────────────────────────────────────────────────────
# RunPod GPU IDs → VRAM GB
RUNPOD_TARGETS: Dict[str, int] = {
    "NVIDIA GeForce RTX 4090":              24,
    "NVIDIA GeForce RTX 5090":              32,
    "NVIDIA RTX PRO 4500 Blackwell":        32,
    "NVIDIA A40":                           48,
    "NVIDIA L40":                           48,
    "NVIDIA L40S":                          48,
    "NVIDIA L4":                            24,
    "NVIDIA GeForce RTX 3090":              24,
    "NVIDIA GeForce RTX 3090 Ti":           24,
    "NVIDIA RTX A5000":                     24,
    "NVIDIA RTX A6000":                     48,
    "NVIDIA RTX 6000 Ada Generation":       48,
    "NVIDIA RTX 5000 Ada Generation":       32,
}

# Vast.ai uses underscores; map from display name → vast gpu_name filter
VAST_GPU_NAMES = [
    "RTX_4090", "RTX_5090", "A40", "L40", "L40S", "L4",
    "RTX_3090", "RTX_3090_Ti", "RTX_A5000", "RTX_A6000",
    "RTX_6000_Ada", "RTX_5000_Ada",
]

MIN_VRAM_MB = 24000   # 24GB minimum for AWQ-32B

RUNPOD_GQL   = "https://api.runpod.io/graphql"
VAST_BUNDLES = "https://console.vast.ai/api/v0/bundles/"
CONFIG_FILE  = Path.home() / "pod" / "supa_config.env"
HISTORY_FILE = Path.home() / "pod" / "scout_history.json"

PROBE_DCS = [
    "US-CA-2", "US-TX-3", "US-KS-2", "US-GA-1", "EU-RO-1",
    "EU-SE-1", "EU-CZ-1", "CA-MTL-1", "OC-AU-1", "SEA-SG-1",
]

GPU_QUERY = """query {
  gpuTypes {
    id displayName memoryInGb
    secureCloud communityCloud
    maxGpuCountCommunityCloud maxGpuCountSecureCloud
    communityPrice securePrice
  }
}"""

DC_QUERY = "query { myself { datacenters { id name location } } }"

# ── Helpers ───────────────────────────────────────────────────────────────────

def read_config() -> Dict[str, str]:
    cfg: Dict[str, str] = {}
    if CONFIG_FILE.exists():
        for line in CONFIG_FILE.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip().strip("\"'")
    return cfg

def read_api_key(override: str = "") -> str:
    if override: return override
    v = os.environ.get("RUNPOD_API_KEY", "").strip()
    if v: return v
    return read_config().get("RUNPOD_API_KEY", "")

def read_vast_key(override: str = "") -> str:
    if override: return override
    v = os.environ.get("VAST_API_KEY", "").strip()
    if v: return v
    return read_config().get("VAST_API_KEY", "")

def gql(api_key: str, query: str) -> Dict[str, Any]:
    try:
        r = requests.post(
            f"{RUNPOD_GQL}?api_key={api_key}",
            json={"query": query}, timeout=30,
        )
        r.raise_for_status()
    except requests.HTTPError as e:
        raise RuntimeError(str(e).replace(api_key, "rpa_***")) from None
    data = r.json()
    if "errors" in data:
        raise RuntimeError(f"GQL: {data['errors'][0].get('message','?')}")
    return data

# ── RunPod availability ───────────────────────────────────────────────────────

def runpod_snapshot(api_key: str) -> Dict[str, Any]:
    ts = datetime.now().isoformat(timespec="seconds")
    data = gql(api_key, GPU_QUERY)
    findings: Dict[str, Any] = {}
    for gpu in data.get("data", {}).get("gpuTypes", []):
        gid = gpu.get("id", "")
        if gid not in RUNPOD_TARGETS: continue
        cc = gpu.get("maxGpuCountCommunityCloud") or 0
        sc = gpu.get("maxGpuCountSecureCloud") or 0
        findings[gid] = {
            "label":      gpu.get("displayName", gid),
            "vram":       gpu.get("memoryInGb", 0),
            "comm_count": cc, "sec_count": sc,
            "comm_avail": cc > 0, "sec_avail": sc > 0,
            "comm_price": gpu.get("communityPrice"),
        }
    return {"timestamp": ts, "findings": findings}

def print_runpod(snap: Dict[str, Any], title: str = "RunPod") -> None:
    findings = snap["findings"]
    avail    = sum(1 for f in findings.values() if f["comm_avail"])
    print(f"\n╔{'═'*66}╗")
    print(f"║  {title}  ·  {snap['timestamp']:<50}║")
    print(f"╠{'═'*66}╣")
    print(f"║  {'GPU':<30} {'VRAM':>4}  {'COMM':>6}  {'SEC':>5}  {'$/hr':>6}  ║")
    print(f"╠{'─'*66}╣")
    for gid in sorted(findings, key=lambda g: (not findings[g]["comm_avail"], -findings[g]["vram"])):
        f = findings[gid]
        comm  = f"✓{f['comm_count']}" if f["comm_avail"] else "✗"
        sec   = f"✓{f['sec_count']}"  if f["sec_avail"]  else "✗"
        price = f"${f['comm_price']:.2f}" if f["comm_price"] else "  n/a"
        print(f"║  {f['label']:<30} {f['vram']:>3}G  {comm:>6}  {sec:>5}  {price:>6}  ║")
    print(f"╠{'─'*66}╣")
    print(f"║  {avail}/{len(RUNPOD_TARGETS)} GPUs available on community cloud.{'':<29}║")
    print(f"╚{'═'*66}╝")

# ── Vast.ai availability ──────────────────────────────────────────────────────

def vast_snapshot(api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Query Vast.ai bundles API for all available offers with >= 24GB VRAM.
    Works WITHOUT an API key (public endpoint) but key gives better results.
    """
    ts = datetime.now().isoformat(timespec="seconds")

    q = json.dumps({
        "gpu_ram":    {"gte": MIN_VRAM_MB},
        "num_gpus":   {"eq": 1},
        "reliability": {"gte": 0.90},
        "rentable":   {"eq": True},
    })

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        r = requests.get(VAST_BUNDLES, params={"q": q}, headers=headers, timeout=30)
        r.raise_for_status()
        offers = r.json().get("offers", [])
    except Exception as e:
        return {"timestamp": ts, "error": str(e), "by_gpu": {}, "by_location": {}}

    # Group by GPU name
    by_gpu: Dict[str, Dict] = defaultdict(lambda: {
        "count": 0, "min_price": 999, "locations": defaultdict(int)
    })
    by_location: Dict[str, Dict] = defaultdict(lambda: {
        "count": 0, "gpus": defaultdict(int), "min_price": 999
    })

    for offer in offers:
        gpu   = offer.get("gpu_name", "unknown")
        vram  = (offer.get("gpu_ram") or 0) // 1024  # MB → GB
        price = offer.get("dph_total") or offer.get("dph_base") or 0
        loc   = offer.get("geolocation", "?")
        country = loc.split(",")[-1].strip() if "," in loc else loc

        by_gpu[gpu]["count"]        += 1
        by_gpu[gpu]["vram"]          = vram
        by_gpu[gpu]["min_price"]     = min(by_gpu[gpu]["min_price"], price)
        by_gpu[gpu]["locations"][country] += 1

        by_location[country]["count"]     += 1
        by_location[country]["gpus"][gpu] += 1
        by_location[country]["min_price"]  = min(by_location[country]["min_price"], price)

    return {
        "timestamp":   ts,
        "total_offers": len(offers),
        "by_gpu":      dict(by_gpu),
        "by_location": dict(by_location),
    }

def print_vast(snap: Dict[str, Any]) -> None:
    if "error" in snap:
        print(f"\n  Vast.ai error: {snap['error']}\n")
        return

    by_gpu = snap["by_gpu"]
    by_loc = snap["by_location"]
    total  = snap["total_offers"]

    print(f"\n╔{'═'*66}╗")
    print(f"║  Vast.ai  ·  {snap['timestamp']:<52}║")
    print(f"╠{'═'*66}╣")
    print(f"║  {total} total offers with ≥24GB VRAM, reliability ≥90%{'':<13}║")
    print(f"╠{'─'*66}╣")
    print(f"║  {'GPU':<28} {'VRAM':>4}  {'Count':>6}  {'From':>6}  {'Min $/hr':>9}  ║")
    print(f"╠{'─'*66}╣")

    for gpu, info in sorted(by_gpu.items(), key=lambda x: -x[1]["count"]):
        vram    = info.get("vram", 0)
        count   = info["count"]
        locs    = len(info["locations"])
        price   = info["min_price"]
        p_str   = f"${price:.3f}" if price < 999 else "  n/a"
        print(f"║  {gpu:<28} {vram:>3}G  {count:>6}  {locs:>5}×  {p_str:>9}  ║")

    print(f"╠{'─'*66}╣")
    print(f"║  Top locations by offer count:{'':<36}║")
    top_locs = sorted(by_loc.items(), key=lambda x: -x[1]["count"])[:8]
    for loc, info in top_locs:
        gpus = ", ".join(sorted(info["gpus"])[:3])
        print(f"║    {loc:<18}  {info['count']:>4} offers  from ${info['min_price']:.3f}/hr  ║")
    print(f"╚{'═'*66}╝")

# ── DC probe (RunPod) ─────────────────────────────────────────────────────────

def probe_datacenters(api_key: str, template_id: str) -> None:
    print(f"\n╔{'═'*56}╗")
    print(f"║  RunPod DC Probe  ·  {datetime.now().strftime('%H:%M:%S'):<34}║")
    print(f"╠{'═'*56}╣")

    # Get real DC IDs from API to validate our list
    try:
        dc_data  = gql(api_key, DC_QUERY)
        known_dcs = {dc["id"]: dc for dc in
                     dc_data.get("data",{}).get("myself",{}).get("datacenters",[])}
        print(f"║  RunPod reports {len(known_dcs)} known datacenters.{'':<22}║")
        for dc_id in sorted(known_dcs):
            loc = known_dcs[dc_id].get("location","")
            marker = " ← probing" if dc_id in PROBE_DCS else ""
            print(f"║    {dc_id:<14} {loc:<28}{marker:<10}║")
    except Exception as e:
        known_dcs = {}
        print(f"║  Warning: {e}  ║")

    print(f"╠{'─'*56}╣")
    print(f"║  Testing {len(PROBE_DCS)} DCs × {len(RUNPOD_TARGETS)} GPUs ...{'':<25}║")
    print(f"╠{'─'*56}╣")

    results: Dict[str, Dict] = {}
    for dc_id in PROBE_DCS:
        hits = []
        errors = []
        for gpu_id in list(RUNPOD_TARGETS)[:4]:  # test first 4 GPUs per DC for speed
            mut = f"""mutation {{
              podFindAndDeployOnDemand(input: {{
                gpuTypeId: {json.dumps(gpu_id)}
                gpuCount: 1
                containerDiskInGb: 10
                volumeInGb: 0
                templateId: {json.dumps(template_id)}
                dataCenterId: {json.dumps(dc_id)}
                cloudType: COMMUNITY
                startJupyter: false
                startSsh: false
              }}) {{ id desiredStatus }}
            }}"""
            try:
                resp = gql(api_key, mut)
                pod  = (resp.get("data") or {}).get("podFindAndDeployOnDemand")
                if pod and pod.get("id"):
                    hits.append(gpu_id.split()[-1])
                    try: gql(api_key, f'mutation {{ podTerminate(input: {{ podId: "{pod["id"]}" }}) }}')
                    except Exception: pass
            except Exception as e:
                errors.append(str(e)[:60])
            time.sleep(0.3)

        results[dc_id] = {"hits": hits, "errors": errors}
        status = f"✓ {', '.join(hits)}" if hits else (f"✗ ({errors[0][:30]})" if errors else "✗ nothing")
        print(f"║  {dc_id:<12}  {status:<42}║")

    print(f"╚{'═'*56}╝\n")
    Path(CONFIG_FILE.parent / "dc_probe_results.json").write_text(
        json.dumps({"timestamp": datetime.now().isoformat(), "results": {
            k: {"hits": v["hits"], "error_sample": v["errors"][:1]}
            for k, v in results.items()
        }}, indent=2)
    )

# ── History ───────────────────────────────────────────────────────────────────

def load_history() -> List[Dict]:
    if HISTORY_FILE.exists():
        try: return json.loads(HISTORY_FILE.read_text())
        except Exception: return []
    return []

def save_history(h: List[Dict]) -> None:
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(h, indent=2))

def print_report(history: List[Dict]) -> None:
    if not history:
        print("\nNo history. Run without --report first.\n"); return
    n = len(history)
    gpu_hits: Dict[str, int] = defaultdict(int)
    gpu_counts: Dict[str, List[int]] = defaultdict(list)
    for snap in history:
        for gid, f in snap.get("findings", {}).items():
            if f.get("comm_avail"):
                gpu_hits[gid] += 1
                gpu_counts[gid].append(f.get("comm_count", 0))
    print(f"\n{'═'*58}")
    print(f"  RunPod Availability Report  ·  {n} samples")
    print(f"{'═'*58}")
    print(f"  {'GPU':<30}  {'Avail%':>7}  {'Avg':>5}  Bar")
    print("  " + "─"*56)
    for gid in sorted(gpu_hits, key=lambda g: -gpu_hits[g]):
        label = next((v["label"] for s in history
                      for k,v in s.get("findings",{}).items() if k==gid), gid)
        pct   = gpu_hits[gid] / n * 100
        avg   = sum(gpu_counts[gid])/len(gpu_counts[gid]) if gpu_counts[gid] else 0
        bar   = "█"*int(pct/5) + "░"*(20-int(pct/5))
        print(f"  {label[:30]:<30}  {pct:>6.0f}%  {avg:>5.1f}  {bar}")
    print()

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--poll",       type=int, metavar="MIN")
    p.add_argument("--vast",       action="store_true",  help="Vast.ai snapshot only")
    p.add_argument("--both",       action="store_true",  help="RunPod + Vast.ai")
    p.add_argument("--probe-dcs",  action="store_true",  help="Test per-DC (creates+destroys pods)")
    p.add_argument("--report",     action="store_true")
    p.add_argument("--clear",      action="store_true")
    p.add_argument("--api-key",    metavar="KEY")
    p.add_argument("--vast-key",   metavar="KEY",        help="Vast.ai API key (optional)")
    p.add_argument("--template",   metavar="ID",         default="sozywnsohq")
    args = p.parse_args()

    if args.clear:
        HISTORY_FILE.unlink(missing_ok=True); print("History cleared."); return
    if args.report:
        print_report(load_history()); return

    vast_key    = read_vast_key(args.vast_key or "")
    runpod_key  = read_api_key(args.api_key or "")

    if args.vast:
        print_vast(vast_snapshot(vast_key)); return

    if not runpod_key and not args.vast:
        print(f"\nNo RunPod API key. Set RUNPOD_API_KEY in {CONFIG_FILE}\n"); sys.exit(1)

    if args.probe_dcs:
        ans = input("\n⚠  Probe creates+destroys test pods. < $0.10 cost. Continue? [y/N] ")
        if ans.strip().lower() != "y": return
        probe_datacenters(runpod_key, args.template); return

    history = load_history()

    if args.poll:
        print(f"Polling every {args.poll} min (RunPod). Ctrl+C to stop.")
        while True:
            try:
                snap = runpod_snapshot(runpod_key)
                print_runpod(snap)
                if args.both:
                    print_vast(vast_snapshot(vast_key))
                history.append(snap); save_history(history)
                print(f"  [{len(history)} samples]  next in {args.poll}m\n")
                time.sleep(args.poll * 60)
            except KeyboardInterrupt:
                print("\nStopped."); print_report(history); break
            except Exception as e:
                print(f"  Error: {e}  retrying in {args.poll}m")
                time.sleep(args.poll * 60)
    else:
        snap = runpod_snapshot(runpod_key)
        print_runpod(snap)
        if args.both:
            print_vast(vast_snapshot(vast_key))
        history.append(snap); save_history(history)
        print(f"  [{len(history)} samples saved]\n")

if __name__ == "__main__":
    main()