# native-first v6.1 iterations

## Task: A01
Commit: pending
Changed: src/extension.ts, src/pi/adapter.ts, src/config.ts, src/commands.ts, src/contracts.ts, src/telemetry/metrics.ts, src/plugin.ts, src/projection/planner.ts, src/checkpoint/capsule.ts, src/checkpoint/semantic.ts, package.json, pnpm-lock.yaml, docs/CONFIGURATION.md, test/unit/config-effective.test.ts, test/host/config-activation.test.ts, test/unit/config.test.ts, test/unit/contracts.test.ts, test/fault/runtime.test.ts
RED: `pnpm exec vitest run test/unit/config-effective.test.ts --config vitest.config.ts` exit 1 — trusted `.pi/pctx.json` stayed observe; schemaVersion 5 accepted; no warnings; `fold` unknown; schemaVersion required 5
GREEN: `pnpm exec vitest run test/unit/config-effective.test.ts test/host/config-activation.test.ts --config vitest.config.ts` exit 0 — 8 tests; `pnpm typecheck` exit 0
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: `src/checkpoint` and exposure ledger still present until C01; v5 planner gates hardcoded until C03; Node v22.17.0 vs engines >=22.19.0; files beyond the A01 card (`src/plugin.ts` and compile-adjacent modules) were required for typecheck after `PctxConfig` schema 6
