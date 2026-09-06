#!/usr/bin/env bash
set -Eeuo pipefail
cd /tmp/pi-context-gate-20260905-2215
trap 'code=$?; echo "finished exit=$code at $(date -u +%FT%TZ)"; exit "$code"' EXIT
set -a
source /Users/luo/Documents/github/pi-context/.env
set +a
export PATH=/Users/luo/.nvm/versions/node/v22.19.0/bin:$PATH
export PCR_LIVE=1 PCR_W2_LIVE_PROFILE=gate
unset PI_OFFLINE PCR_W2_LIVE_OUT_DIR
printf '300 gate started at %s snapshot=%s\n' "$(date -u +%FT%TZ)" "$PWD"
pnpm exec tsx tests/live-gate/paired-w2-live.ts
node scripts/release/verify-w2-live.mjs
