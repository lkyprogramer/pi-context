# Configuration (6.1)

pi-context 6.1 reads `pctx.json` (`schemaVersion: 6`). Old `pctx-v5.json` is ignored and surfaces as `ignored-legacy-config` on `/pctx status`. There is no automatic migration.

## Paths

| File | When it applies |
|---|---|
| `~/.pi/agent/pctx.json` | Always, if present |
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
    "stubHeadChars": 120
  },
  "telemetry": { "includeContent": false, "jsonl": false, "maxLogBytes": 5242880 }
}
```

`persistent` indexing needs an explicit `storage.dbPath` (recommended `~/.pi/agent/pctx/index.sqlite`); otherwise the index stays memory-only. `fold.triggerPercent` must be `< 85`. `fold.targetPercent` must be `< triggerPercent`. `telemetry.includeContent` cannot be true. Unknown fields, NaN, and negatives are `PCTX_CONFIG`.

## Profiles

| Profile | Native request | `pctx_history` | Fold |
|---|---|---|---|
| `off` | unchanged | disabled | none |
| `observe` (default) | unchanged | on, scope-limited | none |
| `balanced` | fold old exposed tool results after the usage threshold | same as observe | threshold, then freeze |

`/pctx profile <p>` changes the in-memory profile only. It does not write `pctx.json`.

Local-eval run `20260908-215433` on `openclaw/Qwen3.8-27B-WORK` decided **`observe-only`**. Keep the default profile `observe`. `balanced` / `fold` remain in the schema so a later environment can opt in, but they are **not recommended in this environment**.

## Status

`/pctx status` prints `resolvedProfile`, `configHash`, `configSource`, `warnings`, `hostVersion`, `contextWindow`, and `contextPercent` (the last two from `ctx.getContextUsage()`). Load failures force `observe`, keep the error in `warnings`, and notify once.

`checkpoint`, `semantic`, and `projection` config sections are rejected. Those features are removed in 6.1.
