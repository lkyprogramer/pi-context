# Security (6.1)

pi-context is a private plugin for official Pi 0.85.1. It does not publish, does not patch the host, and does not ship credentials.

## Secrets

- Put model keys only in the gitignored repo `.env` (`PCR_LIVE_API_KEY` / `PCTX_MODEL_API_KEY`) or the user's own Pi config.
- Do not write tokens into source, tests, manifests, commits, telemetry jsonl, or chat replies.
- `eval/local/seeds/*.secret` and `artifacts/local-eval/` stay local. Rotate a key that has entered a session JSONL or a log.

## Packed install

- Unique entry is `dist/extension.js`. Packed artifacts must not contain test fixtures, `.env`, or live session dumps.
- `/pctx` load failures force `observe` and surface the error in `warnings`. They do not fall open into `balanced`.

## History scope

- `pctx_history` search and read are limited to the current session's visible ancestors.
- Read is hash-checked (`sourceHash`). Stale refs fail closed.
- Search fail-closes when the index is unavailable. Read still uses native session entries.

## Fold

- `balanced` never folds `isError` tool results, non-text blocks, or the most recent complete batches.
- Fold is off unless a trusted `pctx.json` sets `profile: "balanced"`. `/pctx profile` is in-memory only.

## Eval isolation

- Grader containers use `--network none`. Candidate sources are read-only. `verify.sh` / Oracle come from the trusted fixture copy.
- Agent containers should only need the model endpoint. Isolation is not proven for arbitrary host egress on Docker Desktop / OrbStack.
- H03 may run on the host with a temporary `HOME`. Restore `HOME` before `grade.sh` so Docker still finds `~/.docker`.
- Do not copy host `auth.json` or secret-bearing `models.json` into an episode arm.

## Doctor and reports

`/pctx doctor` and eval reports must not print raw secrets. Missing usage or engine metrics stay unknown / n/a, never zeroed.
