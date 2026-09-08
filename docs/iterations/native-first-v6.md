# native-first v6.1 iterations

## Task: A01
Commit: 1fc8ff341ae69a3535ecc077f3c4fd1bfddc12c3
Changed: src/extension.ts, src/pi/adapter.ts, src/config.ts, src/commands.ts, src/contracts.ts, src/telemetry/metrics.ts, src/plugin.ts, src/projection/planner.ts, src/checkpoint/capsule.ts, src/checkpoint/semantic.ts, package.json, pnpm-lock.yaml, docs/CONFIGURATION.md, test/unit/config-effective.test.ts, test/host/config-activation.test.ts, test/unit/config.test.ts, test/unit/contracts.test.ts, test/fault/runtime.test.ts
RED: `pnpm exec vitest run test/unit/config-effective.test.ts --config vitest.config.ts` exit 1 — trusted `.pi/pctx.json` stayed observe; schemaVersion 5 accepted; no warnings; `fold` unknown; schemaVersion required 5
GREEN: `pnpm exec vitest run test/unit/config-effective.test.ts test/host/config-activation.test.ts --config vitest.config.ts` exit 0 — 8 tests; `pnpm typecheck` exit 0
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: `src/checkpoint` and exposure ledger still present until C01; v5 planner gates hardcoded until C03; Node v22.17.0 vs engines >=22.19.0; files beyond the A01 card (`src/plugin.ts` and compile-adjacent modules) were required for typecheck after `PctxConfig` schema 6

## Task: B01
Commit: pending
Changed: src/contracts.ts, src/history/refs.ts, src/history/search.ts, src/history/read.ts, src/history/index.ts, src/plugin.ts, src/history/scope.ts, test/unit/field-ref.test.ts, test/unit/refs.test.ts, test/unit/contracts.test.ts, test/integration/search.test.ts, test/integration/history-read.test.ts, test/integration/index.test.ts, test/security/injection.test.ts, test/security/scope.test.ts, test/property/invariants.test.ts
RED: `pnpm exec vitest run test/unit/field-ref.test.ts --config vitest.config.ts` exit 1 — `refForField is not a function`
GREEN: `pnpm exec vitest run test/unit/field-ref.test.ts test/unit/refs.test.ts --config vitest.config.ts` exit 0 — 5 tests; related 24 tests; `pnpm typecheck` exit 0; `rg -n "blockIndex: 0" src/` 0 hits; `rg -n "indexOf(" src/history/` 0 hits
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: pin/capsule still use v5 `SourceLocator` until C01; fold stub still stores one text ref per entry until C03; `src/history/scope.ts` and adjacent tests were required after `Scope.leafId` became required; index FTS query path still unused until B02
