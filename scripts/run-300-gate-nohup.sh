#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
case "${1:-}" in
  --help|-h) echo "Usage: $0 [--child]"; exit 0 ;;
  ""|--child) ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
esac
if [[ -f "$ROOT/.env" ]]; then set -a; source "$ROOT/.env"; set +a; fi
export PCR_LIVE=1 PCR_W2_LIVE_PROFILE=gate PCR_W2_LIVE_OUT_DIR="$ROOT/artifacts/runs/w2-v4-live/paired-gate"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s /usr/local/opt/nvm/nvm.sh ]]; then source /usr/local/opt/nvm/nvm.sh; elif [[ -s "$NVM_DIR/nvm.sh" ]]; then source "$NVM_DIR/nvm.sh"; else echo 'nvm.sh not found' >&2; exit 1; fi
nvm use v22.19.0
LOG_DIR="$ROOT/artifacts/runs/w2-v4-live/paired-gate"; mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/nohup-300-gate.log"; PID_FILE="$LOG_DIR/nohup-300-gate.pid"
if [[ "${1:-}" == --child ]]; then
  trap 'code=$?; echo "finished exit=$code at $(date -u +%FT%TZ)"; exit "$code"' EXIT
  # The standalone runner resumes matching rows and retains per-request timeouts.
  # Vitest wraps the entire 300-pair batch in a three-hour test timeout.
  pnpm exec tsx tests/live-gate/paired-w2-live.ts
  node scripts/release/verify-w2-live.mjs
  exit 0
fi
if [[ -f "$PID_FILE" ]]; then
  read -r previous_pid < "$PID_FILE"
  if [[ "$previous_pid" =~ ^[0-9]+$ ]] && kill -0 "$previous_pid" 2>/dev/null; then
    echo "Gate process still exists: $previous_pid; refusing duplicate launch" >&2
    exit 1
  fi
fi
nohup bash "$ROOT/scripts/run-300-gate-nohup.sh" --child >>"$LOG_FILE" 2>&1 < /dev/null &
echo $! >"$PID_FILE"
echo "started pid=$(cat "$PID_FILE")"
echo "log=$LOG_FILE"
