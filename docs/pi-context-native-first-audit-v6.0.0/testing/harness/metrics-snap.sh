#!/usr/bin/env bash
# Snapshot NInfer prefix/prefill counters from the compat layer's /metrics into JSON.
# usage: metrics-snap.sh <out.json>
set -euo pipefail
OUT="${1:?out.json}"
PORT="${PCTX_4090_PORT:-18343}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if ! curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/metrics" >"$TMP"; then
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
json.dump(out, open(sys.argv[2], "w"), indent=2)
print(json.dumps(out))
PY
