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

python3 - "$AGENT/models.json" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
prov = data.get("providers", {}).get("work")
if prov is not None:
    prov["baseUrl"] = "http://host.docker.internal:18343/v1"
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
  "${SEED_ENV[@]}" \
  "$IMAGE" node /out/run-in-container.mjs
