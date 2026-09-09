#!/usr/bin/env bash
# Snapshot NInfer prefix/prefill counters from the compat layer's /metrics into JSON.
# usage: metrics-snap.sh <out.json>
# Missing or unauthenticated /metrics (public GET is 401 without the API key) → {"available":false}, never invented zeros.
set -euo pipefail
OUT="${1:?out.json}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE"
while [[ "$REPO" != "/" && ! -f "$REPO/package.json" ]]; do REPO="$(dirname "$REPO")"; done
if [[ -f "$REPO/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env"
  set +a
fi
BASE="${PCTX_MODEL_BASE_URL:-${PCR_LIVE_BASE_URL:-http://47.106.205.246:1082/v1}}"
METRICS_URL="$(python3 -c 'from urllib.parse import urlparse; import os,sys; u=urlparse(sys.argv[1]); print(u.scheme+"://"+u.netloc+"/metrics")' "$BASE")"
KEY="${PCTX_MODEL_API_KEY:-${PCR_LIVE_API_KEY:-}}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
AUTH=()
if [[ -n "$KEY" ]]; then AUTH=(-H "Authorization: Bearer ${KEY}"); fi
if ! curl -fsS --max-time 8 "${AUTH[@]}" "$METRICS_URL" >"$TMP"; then
  echo '{"available":false}' >"$OUT"; exit 0
fi
python3 - "$TMP" "$OUT" <<'PY'
import json, re, sys, time
text = open(sys.argv[1], errors="replace").read()
keys = {
    "requests": "ninfer:requests_total",
    "prefixHitTokens": "ninfer:prefix_cache_hit_tokens_total",
    "prefillTokens": "llamacpp:prompt_tokens_total",
    "stableRestores": "ninfer:continuation_stable_prefix_restores_total",
    "continuationHits": "ninfer:continuation_lookup_hits_total",
}
out = {"available": True, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
for name, key in keys.items():
    m = re.search(rf"^{re.escape(key)} (\S+)", text, re.M)
    out[name] = float(m.group(1)) if m else None
if not any(out.get(k) is not None for k in keys):
    out["available"] = False
json.dump(out, open(sys.argv[2], "w"), indent=2)
print(json.dumps(out))
PY
