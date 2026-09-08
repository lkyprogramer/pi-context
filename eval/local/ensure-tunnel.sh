#!/usr/bin/env bash
# Idempotent local tunnel to the 4090 production NInfer compat layer (18343).
# Never changes anything on the 4090. Exits non-zero if the served model/window is not the expected NInfer profile.
set -euo pipefail
HOST="${PCTX_4090_HOST:-hhtele@192.168.10.29}"
PORT="${PCTX_4090_PORT:-18343}"
EXPECT_MODEL="${PCTX_EXPECT_MODEL:-openclaw/Qwen3.8-27B-WORK}"
EXPECT_CTX="${PCTX_EXPECT_CTX:-262144}"

check() {
  local body
  body="$(curl -fsS --max-time 4 "http://127.0.0.1:${PORT}/v1/models" 2>/dev/null)" || return 1
  printf '%s' "$body" | python3 -c '
import json, sys
exp_model, exp_ctx = sys.argv[1], int(sys.argv[2])
d = json.load(sys.stdin)
m = d["data"][0]
ok = m["id"] == exp_model and int(m["meta"]["n_ctx"]) == exp_ctx
print("model=%s n_ctx=%s ok=%s" % (m["id"], m["meta"]["n_ctx"], ok))
sys.exit(0 if ok else 3)
' "$EXPECT_MODEL" "$EXPECT_CTX"
}

if check; then echo "tunnel already up"; exit 0; fi
pkill -f "ssh .*${PORT}:127.0.0.1:${PORT}" 2>/dev/null || true
ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "127.0.0.1:${PORT}:127.0.0.1:${PORT}" "$HOST"
sleep 1
check || { echo "tunnel up but served model/window differs from expected NInfer profile; stop E-phase" >&2; exit 3; }
echo "tunnel ready"
