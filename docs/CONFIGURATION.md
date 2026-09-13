# Configuration (6.1)

pi-context 6.1 reads `pctx.json` (`schemaVersion: 6`). Old `pctx-v5.json` is ignored and surfaces as `ignored-legacy-config` on `/pctx status`. There is no automatic migration.

## Paths

`<agentDir>` follows Pi's own resolution: `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`. The same dir holds `pctx-status.json`, the persistent index and fold-plan files.

| File | When it applies |
|---|---|
| `<agentDir>/pctx.json` | Always, if present |
| `<cwd>/.pi/pctx.json` | Only when the host reports the project as trusted (`ctx.isProjectTrusted()`). Requires Pi `settings.json` `defaultProjectTrust: "always"` or an explicit trust decision. Untrusted project files are skipped with `untrusted-project-config`. |
| `~/.pi/agent/pctx-v5.json` / `<cwd>/.pi/pctx-v5.json` | Never loaded. Warning only. |

Project files are never trusted by default.

## Defaults

```json
{
  "schemaVersion": 6,
  "profile": "observe",
  "storage": { "mode": "persistent", "dbPath": null, "maxIndexBytes": 268435456 },
  "history": { "searchLimit": 8, "searchMaxTokens": 1500, "readMaxTokens": 3000, "readMaxBytes": 32768 },
  "fold": {
    "triggerPercent": 60,
    "targetPercent": 40,
    "protectRecentBatches": 4,
    "minRemovedTokens": 4096,
    "minFoldableBytes": 1024,
    "stubHeadChars": 120,
    "stubHeadBytes": 0,
    "stubTailBytes": 0
  },
  "telemetry": { "includeContent": false, "jsonl": false, "maxLogBytes": 5242880 }
}
```

`storage.dbPath: null` with `mode: "persistent"` uses `<agentDir>/pctx/index.sqlite`; set `dbPath` to move it. Workspaces at `HOME` or `/` always stay memory-only regardless of `mode`. Search fail-closes when the index is down; `pctx_history` read still walks native session entries. `fold.triggerPercent` must be `< 85`. `fold.targetPercent` must be `< triggerPercent`. `stubHeadBytes` / `stubTailBytes` default to 0 (current 120-character first-line head, no tail). They are candidate flags only: `stubHeadBytes=512` and `stubHeadBytes=512` plus `stubTailBytes=512` (OP-style). Do not change the default unless a recall live shows `firstAttemptRecallSuccess` up and fold savings down by less than 10%. `telemetry.includeContent` cannot be true. Unknown fields, NaN, and negatives are `PCTX_CONFIG`. The 6.1-next-steps work does not change these defaults. Current delivery decision: `limited-balanced-trial` (run `review-r8-20260911b`, HEAD `878e92f292a7`).

## Profiles

| Profile | Native request | `pctx_history` | Fold |
|---|---|---|---|
| `off` | unchanged | disabled | none |
| `observe` (default) | unchanged until native compact; then a ≤1.5 KB evidence index may be appended to the compact summary | on, scope-limited | none |
| `balanced` | fold old exposed tool results after the usage threshold | same as observe | threshold, then freeze |

`pctx_history read` also accepts a SoL-Pi ObservationPack id `obs_<24hex>` when a persistent session dir is present. The object is served only after the OP ledger `contentHash` matches. Reducer receipts stay as-is; the original `source_artifact` is indexed for search.

`/pctx profile <p>` changes the in-memory profile only. It does not write `pctx.json`.

Round-8 live `review-r8-20260911b` on `openclaw/Qwen3.8-27B-WORK` decided **`limited-balanced-trial`** (personal explicit trial). Keep the default profile `observe`. `balanced` / `fold` remain default-off; they are a trial in this environment, not a new default. The earlier run `20260909-112407` is superseded as a delivery claim.

## Status

`/pctx status` prints `resolvedProfile`, `configHash`, `configSource`, `warnings`, `hostVersion`, `contextWindow`, and `contextPercent` (the last two from `ctx.getContextUsage()`). Load failures force `observe`, keep the error in `warnings`, and notify once.

`checkpoint`, `semantic`, and `projection` config sections are rejected. Those features are removed in 6.1.
