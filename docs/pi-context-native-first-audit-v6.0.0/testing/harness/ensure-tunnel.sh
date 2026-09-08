#!/usr/bin/env bash
# Reach the live NInfer OpenAI-compat endpoint and confirm model id + n_ctx.
# Default is http://47.106.205.246:1082/v1. Loopback URLs still open an SSH tunnel.
# Credentials come from the gitignored repo .env (PCR_LIVE_API_KEY); this script never prints them.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE"
while [[ "$REPO" != "/" && ! -f "$REPO/package.json" ]]; do REPO="$(dirname "$REPO")"; done
if [[ -f "$REPO/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env"
  set +a
fi
export PCTX_MODEL_BASE_URL="${PCTX_MODEL_BASE_URL:-${PCR_LIVE_BASE_URL:-http://47.106.205.246:1082/v1}}"
PCTX_MODEL_BASE_URL="${PCTX_MODEL_BASE_URL%/}"
export PCTX_MODEL_BASE_URL
export PCTX_EXPECT_MODEL="${PCTX_EXPECT_MODEL:-openclaw/Qwen3.8-27B-WORK}"
export PCTX_EXPECT_CTX="${PCTX_EXPECT_CTX:-262144}"

check() {
  python3 - <<'PY'
import json, os, sys, urllib.error, urllib.request
base = os.environ["PCTX_MODEL_BASE_URL"].rstrip("/")
key = os.environ.get("PCTX_MODEL_API_KEY") or os.environ.get("PCR_LIVE_API_KEY") or ""
exp_model = os.environ["PCTX_EXPECT_MODEL"]
exp_ctx = int(os.environ["PCTX_EXPECT_CTX"])
headers = {"Authorization": f"Bearer {key}"} if key else {}
req = urllib.request.Request(base + "/models", headers=headers)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.load(r)
except Exception as e:
    print("models fetch failed: %s" % e, file=sys.stderr)
    sys.exit(1)
m = (d.get("data") or [None])[0]
if not m:
    print("models list empty", file=sys.stderr)
    sys.exit(3)
n_ctx = int((m.get("meta") or {}).get("n_ctx") or m.get("context_window") or 0)
ok = m.get("id") == exp_model and n_ctx == exp_ctx
print("model=%s n_ctx=%s ok=%s" % (m.get("id"), n_ctx, ok))
sys.exit(0 if ok else 3)
PY
}

HOST_NAME="$(python3 -c 'from urllib.parse import urlparse; import os; print(urlparse(os.environ["PCTX_MODEL_BASE_URL"]).hostname or "")')"
if [[ "$HOST_NAME" != "127.0.0.1" && "$HOST_NAME" != "localhost" ]]; then
  check || { echo "endpoint reachable but served model/window differs from expected NInfer profile; stop E-phase" >&2; exit 3; }
  echo "endpoint ready"
  exit 0
fi

if check; then echo "tunnel already up"; exit 0; fi
HOST="${PCTX_4090_HOST:-hhtele@192.168.10.29}"
PORT="$(python3 -c 'from urllib.parse import urlparse; import os; print(urlparse(os.environ["PCTX_MODEL_BASE_URL"]).port or 80)')"
pkill -f "ssh .*${PORT}:127.0.0.1:${PORT}" 2>/dev/null || true
ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "127.0.0.1:${PORT}:127.0.0.1:${PORT}" "$HOST"
sleep 1
check || { echo "tunnel up but served model/window differs from expected NInfer profile; stop E-phase" >&2; exit 3; }
echo "tunnel ready"
