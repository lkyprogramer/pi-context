#!/usr/bin/env bash
# Run the Pi agent for one episode inside pctx-t21-sandbox:0.85.1.
#   run-agent.sh <workdir> <agentDir> <episodeDir> <windowProfile>
# Parent must already be running the credential broker.
# Never sources .env and never writes an upstream API key.
# Linux bind: PCTX_BROKER_SOCK on the host, mounted at /run/pctx.
# Darwin volume: PCTX_BROKER_VOLUME named volume at /run/pctx.
# Agent always uses --network none.
set -euo pipefail
WORK="$(cd "${1:?workdir}" && pwd)"
AGENT="$(cd "${2:?agentDir}" && pwd)"
OUT="$(cd "${3:?episodeDir}" && pwd)"
WINDOW="${4:?window}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
IMAGE="${PCTX_SANDBOX_IMAGE:-pctx-t21-sandbox:0.85.1}"
TOKEN="${PCTX_BROKER_TOKEN:?opaque broker token required}"
VOLUME="${PCTX_BROKER_VOLUME:-}"
SOCK="${PCTX_BROKER_SOCK:-}"

if ! command -v docker >/dev/null 2>&1 || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "blocked: sandbox image $IMAGE missing" >&2
  exit 3
fi

python3 - "$AGENT/models.json" "$TOKEN" <<'PY'
import json, sys
path, token = sys.argv[1], sys.argv[2]
data = json.load(open(path))
prov = data.get("providers", {}).get("work")
if prov is not None:
    prov["baseUrl"] = "http://127.0.0.1:8080/v1"
    prov["apiKey"] = token
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
PY

cp "$HERE/run-in-container.mjs" "$OUT/run-in-container.mjs"
cp "$REPO/eval/sandbox/unix-relay.mjs" "$OUT/unix-relay.mjs"
chmod u+rwX "$WORK" "$AGENT" "$OUT" || true

# Always pass PCTX_SEED. Empty means no seed file (X01). Do not use an empty
# array here: macOS bash 3.2 + set -u treats "${arr[@]}" as unbound.
SEED_PATH=""
if [[ -f "$OUT/seed.jsonl" ]]; then
  SEED_PATH=/out/seed.jsonl
fi
BUDGET_ENV=(
  -e "PCTX_BUDGET_WALL_MS=${PCTX_BUDGET_WALL_MS:-900000}"
  -e "PCTX_BUDGET_MODEL=${PCTX_BUDGET_MODEL:-40}"
  -e "PCTX_BUDGET_TOOLS=${PCTX_BUDGET_TOOLS:-80}"
)

SOCK_MOUNT=()
if [[ -n "$VOLUME" ]]; then
  SOCK_MOUNT=(-v "$VOLUME:/run/pctx")
elif [[ -n "$SOCK" ]]; then
  if [[ ! -S "$SOCK" ]]; then
    echo "blocked: broker socket missing" >&2
    exit 3
  fi
  SOCK_DIR="$(cd "$(dirname "$SOCK")" && pwd)"
  if [[ "$(basename "$SOCK")" != "broker.sock" ]]; then
    echo "blocked: broker socket must be named broker.sock for the /run/pctx mount" >&2
    exit 3
  fi
  SOCK_MOUNT=(-v "$SOCK_DIR:/run/pctx")
else
  echo "blocked: PCTX_BROKER_VOLUME or PCTX_BROKER_SOCK required" >&2
  exit 3
fi

docker run --rm \
  --network none \
  --read-only --tmpfs /tmp:rw,exec,size=1g \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --memory 4g --pids-limit 512 \
  -v "$WORK:/work" \
  -v "$AGENT:/home/node/.pi/agent" \
  -v "$REPO/dist:/plugin:ro" \
  -v "$OUT:/out" \
  "${SOCK_MOUNT[@]}" \
  -e PCTX_WINDOW="$WINDOW" \
  -e PCTX_PROMPTS=/out/prompts.json \
  -e PCTX_HOST_VERSION=0.85.1 \
  -e PCR_BROKER_SOCK=/run/pctx/broker.sock \
  "${BUDGET_ENV[@]}" \
  -e "PCTX_SEED=$SEED_PATH" \
  "$IMAGE" sh -c 'node /out/unix-relay.mjs & exec node /out/run-in-container.mjs'
