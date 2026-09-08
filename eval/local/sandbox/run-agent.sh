#!/usr/bin/env bash
# Run the Pi agent for one episode inside pctx-t21-sandbox:0.85.1.
#   run-agent.sh <workdir> <agentDir> <episodeDir> <windowProfile>
# Prompts: <episodeDir>/prompts.json. Optional seed: <episodeDir>/seed.jsonl.
# Does not fall back to the host. Missing image → exit 3 (blocked).
set -euo pipefail
WORK="$(cd "${1:?workdir}" && pwd)"
AGENT="$(cd "${2:?agentDir}" && pwd)"
OUT="$(cd "${3:?episodeDir}" && pwd)"
WINDOW="${4:?window}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
IMAGE="${PCTX_SANDBOX_IMAGE:-pctx-t21-sandbox:0.85.1}"

if ! command -v docker >/dev/null 2>&1 || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "blocked: sandbox image $IMAGE missing" >&2
  exit 3
fi

if [[ -f "$REPO/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env"
  set +a
fi
export PCTX_MODEL_BASE_URL="${PCTX_MODEL_BASE_URL:-${PCR_LIVE_BASE_URL:-http://47.106.205.246:1082/v1}}"
python3 - "$AGENT/models.json" <<'PY'
import json, os, sys
from urllib.parse import urlparse, urlunparse
path = sys.argv[1]
data = json.load(open(path))
prov = data.get("providers", {}).get("work")
if prov is not None:
    base = (os.environ.get("PCTX_MODEL_BASE_URL") or os.environ.get("PCR_LIVE_BASE_URL") or prov.get("baseUrl") or "http://47.106.205.246:1082/v1").rstrip("/")
    u = urlparse(base)
    if u.hostname in ("127.0.0.1", "localhost"):
        host = "host.docker.internal"
        netloc = f"{host}:{u.port}" if u.port else host
        base = urlunparse((u.scheme, netloc, u.path or "/v1", "", "", "")).rstrip("/")
    prov["baseUrl"] = base
    key = os.environ.get("PCTX_MODEL_API_KEY") or os.environ.get("PCR_LIVE_API_KEY")
    if key:
        prov["apiKey"] = key
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
PY

cp "$HERE/run-in-container.mjs" "$OUT/run-in-container.mjs"
chmod -R a+rwX "$WORK" "$AGENT" "$OUT" || true

SEED_ENV=()
if [[ -f "$OUT/seed.jsonl" ]]; then
  SEED_ENV=(-e PCTX_SEED=/out/seed.jsonl)
fi
BUDGET_ENV=(
  -e "PCTX_BUDGET_WALL_MS=${PCTX_BUDGET_WALL_MS:-900000}"
  -e "PCTX_BUDGET_MODEL=${PCTX_BUDGET_MODEL:-40}"
  -e "PCTX_BUDGET_TOOLS=${PCTX_BUDGET_TOOLS:-80}"
)

# Volumes are the only writable paths besides /tmp. No host HOME, .env, SSH, or Docker socket.
# Bash 3.2 + set -u rejects "${empty[@]}".
set +u
docker run --rm --network bridge --read-only --tmpfs /tmp:rw,exec,size=1g \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --memory 4g --pids-limit 512 \
  -v "$WORK:/work" \
  -v "$AGENT:/home/node/.pi/agent" \
  -v "$REPO/dist:/plugin:ro" \
  -v "$OUT:/out" \
  -e PCTX_WINDOW="$WINDOW" \
  -e PCTX_PROMPTS=/out/prompts.json \
  -e PCTX_HOST_VERSION=0.85.1 \
  "${BUDGET_ENV[@]}" \
  "${SEED_ENV[@]}" \
  "$IMAGE" node /out/run-in-container.mjs
