# native-first v6.1 iterations

## Task: A01
Commit: 1fc8ff341ae69a3535ecc077f3c4fd1bfddc12c3
Changed: src/extension.ts, src/pi/adapter.ts, src/config.ts, src/commands.ts, src/contracts.ts, src/telemetry/metrics.ts, src/plugin.ts, src/projection/planner.ts, src/checkpoint/capsule.ts, src/checkpoint/semantic.ts, package.json, pnpm-lock.yaml, docs/CONFIGURATION.md, test/unit/config-effective.test.ts, test/host/config-activation.test.ts, test/unit/config.test.ts, test/unit/contracts.test.ts, test/fault/runtime.test.ts
RED: `pnpm exec vitest run test/unit/config-effective.test.ts --config vitest.config.ts` exit 1 — trusted `.pi/pctx.json` stayed observe; schemaVersion 5 accepted; no warnings; `fold` unknown; schemaVersion required 5
GREEN: `pnpm exec vitest run test/unit/config-effective.test.ts test/host/config-activation.test.ts --config vitest.config.ts` exit 0 — 8 tests; `pnpm typecheck` exit 0
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: `src/checkpoint` and exposure ledger still present until C01; v5 planner gates hardcoded until C03; Node v22.17.0 vs engines >=22.19.0; files beyond the A01 card (`src/plugin.ts` and compile-adjacent modules) were required for typecheck after `PctxConfig` schema 6

## Task: B01
Commit: ce469707be80fe073b972f309bf7d9f43b81b260
Changed: src/contracts.ts, src/history/refs.ts, src/history/search.ts, src/history/read.ts, src/history/index.ts, src/plugin.ts, src/history/scope.ts, test/unit/field-ref.test.ts, test/unit/refs.test.ts, test/unit/contracts.test.ts, test/integration/search.test.ts, test/integration/history-read.test.ts, test/integration/index.test.ts, test/security/injection.test.ts, test/security/scope.test.ts, test/property/invariants.test.ts
RED: `pnpm exec vitest run test/unit/field-ref.test.ts --config vitest.config.ts` exit 1 — `refForField is not a function`
GREEN: `pnpm exec vitest run test/unit/field-ref.test.ts test/unit/refs.test.ts --config vitest.config.ts` exit 0 — 5 tests; related 24 tests; `pnpm typecheck` exit 0; `rg -n "blockIndex: 0" src/` 0 hits; `rg -n "indexOf(" src/history/` 0 hits
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: pin/capsule still use v5 `SourceLocator` until C01; fold stub still stores one text ref per entry until C03; `src/history/scope.ts` and adjacent tests were required after `Scope.leafId` became required; index FTS query path still unused until B02

## Task: B02
Commit: dade5e01ab7d7ee7e760033bb0345cae103037e7
Changed: src/history/index.ts, src/history/search.ts, src/history/scope.ts, src/history/sqlite-worker.ts (deleted), src/pi/source-reader.ts, src/pi/adapter.ts, src/plugin.ts, src/commands.ts, src/contracts.ts, test/unit/history-index-scope.test.ts, test/unit/history-pagination.test.ts, test/host/index-restart.test.ts, test/integration/search.test.ts, test/integration/index.test.ts, test/security/injection.test.ts, test/security/scope.test.ts
RED: `pnpm exec vitest run test/unit/history-index-scope.test.ts --config vitest.config.ts` exit 1 — `createHistoryIndex is not a function`
GREEN: `pnpm exec vitest run test/unit/history-index-scope.test.ts test/unit/history-pagination.test.ts test/security/scope.test.ts --config vitest.config.ts` exit 0 — 10 tests; `pnpm exec vitest run test/host/index-restart.test.ts --config vitest.config.ts` exit 0 — 1 test; `pnpm typecheck` exit 0
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: read paging still uses token-byte walk until B03; checkpoint/pin/ledger remain until C01; node:sqlite FTS5 is experimental on Node v22.17.0; createPlugin starts memory-only until session_start opens persistent

## Task: B03
Commit: a958e96ced8429c463cd0f4ad0eab597999669ec
Changed: src/history/read.ts, src/commands.ts, src/contracts.ts, src/projection/budget.ts, src/plugin.ts, test/unit/history-budget.test.ts, test/host/history-image.test.ts, test/integration/history-read.test.ts
RED: `pnpm exec vitest run test/unit/history-budget.test.ts --config vitest.config.ts` exit 1 — `utf8Prefix is not a function`
GREEN: `pnpm exec vitest run test/unit/history-budget.test.ts test/integration/history-read.test.ts --config vitest.config.ts` exit 0 — 5 tests; `pnpm exec vitest run test/host/history-image.test.ts --config vitest.config.ts` exit 0 — 1 test; `pnpm typecheck` exit 0
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: checkpoint/pin/ledger remain until C01; `src/plugin.ts` was required so historyTool uses `readBudgetFor`; remaining window < 512 tokens fail-closes without a half page

## Task: C01
Commit: 97a19ec844278f564c93c366e4d80326669627a6
Changed: src/checkpoint/* (deleted), src/projection/exposure.ts, src/projection/cache.ts, src/plugin.ts, src/pi/adapter.ts, src/commands.ts, src/contracts.ts, src/projection/planner.ts, src/projection/render.ts, src/telemetry/metrics.ts, test/unit/no-checkpoint.test.ts, test/fault/runtime.test.ts, test/property/invariants.test.ts, test/unit/planner.test.ts, test/unit/render.test.ts, test/unit/economics.test.ts, test/host/matrix.test.ts, test/host/stock-loader.test.ts, test/packed/install.test.ts, test/helpers/official-pi.ts; deleted test/integration/capsule.test.ts, test/fault/staging.test.ts, test/host/semantic.test.ts, test/host/exposure.test.ts, test/host/generation.test.ts
Deleted modules: capsule, pins, semantic, staging, validator, exposure ledger, snapshot-key cache
RED: `pnpm exec vitest run test/unit/no-checkpoint.test.ts --config vitest.config.ts` originally failed on registered `session_before_compact` and existing `src/checkpoint`; this landing re-ran GREEN
GREEN: `pnpm exec vitest run test/unit/no-checkpoint.test.ts test/host/stock-loader.test.ts --config vitest.config.ts` exit 0 — 3 tests; `pnpm typecheck` exit 0; `pnpm exec vitest run --config vitest.config.ts` exit 0 — 85 tests
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: `planEpoch` returns null until C03; FrozenPlan is a placeholder not FoldPlan; PluginState keeps A01/B02 counters beyond the C01 minimal set; `src/config.ts` still names checkpoint/semantic/projection only as rejected legacy keys; host tests resolve official Pi from workspace node_modules when global npm root has no package; `/pctx pin` is unknown command
