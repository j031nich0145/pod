# SupaFantastic — local-first architecture

## What changed

The UI (React + Flask) used to live on the pod. That created a chicken-and-egg
problem: you couldn't see the UI until the pod was up, so every session started
in a terminal running `maestro_global.py` and hoping SSH cooperated.

The new layout:

```
LOCAL                            POD
─────                            ───
React UI       :3000             vLLM   :8000
Flask gateway  :5000                ↑
   /chat ──→  https://{pod_id}-8000.proxy.runpod.net/v1/chat/completions
   /runpod/start ──→ spawns maestro_global.py and streams via SSE
```

The pod runs vLLM only. Everything else is local. The UI is always up, so
Start / Stop / timeout are real buttons, not terminal incantations.

## One-time local setup

```bash
# 1. Put the maestro + Flask gateway in ~/runpod (or anywhere; adjust paths)
mkdir -p ~/runpod
cp app.py maestro_global.py ~/runpod/
chmod 600 ~/runpod/supa_config.env   # if it already exists

# 2. Install Python deps locally
pip install --user flask flask-cors requests

# 3. Clone (or pull) the React app locally — same repo as before
git clone https://github.com/j031nich0145/SupaFantasticLLM ~/SupaFantasticLLM
cd ~/SupaFantasticLLM/app/frontend
npm install
npm run build                 # produces frontend/build, which Flask will serve

# 4. (One-time) put setup_supafantastic_runpod.sh in ~/runpod so maestro
#    can SCP it to the pod on global rebuild paths
cp setup_supafantastic_runpod.sh ~/runpod/
chmod +x ~/runpod/setup_supafantastic_runpod.sh
```

`~/runpod/supa_config.env` should look like:

```bash
RUNPOD_API_KEY="rpa_..."     # rotate the one in start_supa.sh, that key is burned
HF_TOKEN="hf_..."            # optional; helps with rate limits
GITHUB_TOKEN="ghp_..."       # only if your repo is private
GITHUB_USER="j031nich0145"
REPO_NAME="SupaFantasticLLM"
POD_ID="9wn32k1hsou7f3"      # current pod
UI_URL=""                    # filled in by maestro
SSH_HOST=""
SSH_PORT=""
SSH_KEY="$HOME/.ssh/runpod_supa"
SSH_PUBLIC_KEY=""
```

(`chmod 600 ~/runpod/supa_config.env`.)

## Daily workflow

```bash
~/runpod/supa.sh
```

That's it. The launcher:
1. Builds the React app once if no build exists
2. Starts Flask on `:5000`
3. Opens `http://localhost:5000` in your browser

In the UI, hit **Start**. Flask spawns
`maestro_global.py start --yes-global-rebuild --no-open-browser --json-events --skip-if-running`,
and the SSE stream shows real-time progress as it cycles through GPUs and clouds.

When done, hit **Stop** or let the inactivity timeout fire.

## What still uses SSH

Day-to-day chat: **no SSH**. The browser talks to local Flask which talks to
the pod's vLLM through RunPod's HTTPS proxy. The proxy doesn't need SSH.

SSH is used in exactly two places:
- **Once per fresh pod** to run `/workspace/start_all.sh` (kicks off vLLM)
- **Once per global rebuild** to SCP `setup_supafantastic_runpod.sh` and run it

`maestro_global.py` already has `wait_for_ssh_dynamic` that re-polls RunPod for
fresh host/port mappings each loop, so transient SSH-port instability is handled.

## What you can drop now

These files from the old setup are no longer relevant:
- `start_supa.sh` (the local one with the leaked API key — **rotate that key**)
- The pod-side `/workspace/app/SupaFantasticLLM/app/backend/app.py` written by
  the old setup script (won't get rewritten by the new setup; can `rm -rf`)
- The pod-side React install and `start_frontend.sh` (the new `start_all.sh`
  doesn't reference them)

If you want to clean up an existing pod:

```bash
ssh root@... 'rm -rf /workspace/app/SupaFantasticLLM /workspace/node \
  /workspace/scripts/start_backend.sh /workspace/scripts/start_frontend.sh \
  /workspace/start_ui_only.sh'
```

Or just let it sit — nothing on the pod will be started anymore except vLLM.

## Optional: make vLLM auto-start at pod boot

To eliminate SSH entirely from the resume path, set the RunPod template's
**container start command** to run `start_all.sh` after the standard init.
Then maestro doesn't need to SSH in after resume — RunPod boots the pod,
the template's start command runs vLLM, the proxy on `:8000` works, done.

Caveat: editing the template affects every pod created from it. If you want
this, clone the template first and update `TEMPLATE_ID` in `maestro_global.py`.

## Troubleshooting

**SSH still failing after resume**
The most common cause is the template not consuming `$PUBLIC_KEY`. Check the
template's container start command — it should contain something like:
```
echo "$PUBLIC_KEY" >> /root/.ssh/authorized_keys && /usr/sbin/sshd
```
If it doesn't, SSH key injection won't work and you'll hit "permission denied".

**vLLM OOMs on a fallback GPU**
The 20GB cards (RTX PRO 4500) are too tight for AWQ-32B + 8192 context. Either
remove that GPU from `GPU_OPTIONS`, or have `start_vllm.sh` read `GPU_UTIL` /
`MAX_LEN` env vars and dial them down for known-small GPUs.

**The UI loads but `/chat` returns 502**
Means vLLM isn't up yet on the pod. Check `/workspace/logs/vllm.log` via the
RunPod web terminal. Typical first-load delay is ~60-90s while the AWQ weights
are mmap'd into VRAM.
