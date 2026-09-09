# next-fixes (6.1 audit next-steps)

Baseline: `7478307ead72e849e9c619a913858afe8a06d38b`. Default profile stays observe. Fold defaults stay 60/40/4/4096/1024/120.

## R01

Changed: `package.json`, `.github/workflows/required.yml`, `.github/workflows/compatibility.yml`, `test/unit/ci-contract.test.ts`, `docs/iterations/next-fixes.md`

RED: `pnpm exec vitest run test/unit/ci-contract.test.ts --config vitest.config.ts` exit 1 — `scripts.check` was undefined; `required.yml` still called `scripts/ci/compile-runtime.mjs`, `tests/w1-gate`, and `pnpm test:unit`.

GREEN: same command exit 0 — 2 tests; `pnpm typecheck` exit 0.

Implemented: `pnpm check` = typecheck + default vitest + `compat:scan`. required has `check` (Node 22.19.0, pnpm 10.15, frozen install) and `stock-smoke` (`pnpm build && pnpm smoke`). compatibility is `workflow_dispatch` only on Node 24.18.1. No live eval in CI.

vitest exclude (historical, not moved this task):
- `test/integration/eval-runner.test.ts` — removed v5 B0–B3 runner
- `test/unit/report.test.ts` — removed v5 report surface
- `test/integration/java-cases.test.ts` — v5 Java pairing leftover

`publication.yml` still references deleted PCR release scripts; out of R01 file list, left untouched.

`pnpm check` exit 0 — typecheck + 127 tests + `compat:scan` `{ok:true,files:29}`. Remote GitHub Actions on this HEAD not run (no valid push credentials).

## R02

Changed: `src/projection/active-view.ts`, `src/projection/view-contracts.ts`, `src/projection/batches.ts`, `src/projection/planner.ts`, `src/pi/source-reader.ts`, `src/plugin.ts`, `src/commands.ts`, `test/helpers/context-audit-fixture.ts`, `test/unit/active-view.test.ts`, `test/unit/batches.test.ts`, `docs/iterations/next-fixes.md`

`commands.ts` is outside the R02 file list: `/pctx fold` now plans from `viewFromEntries` + branch batches so it cannot republish a file-linear sibling compact as the current boundary.

RED: `pnpm exec vitest run test/unit/active-view.test.ts test/unit/batches.test.ts test/unit/fold-plan.test.ts --config vitest.config.ts` exit 1 — missing `buildActiveView`; P08 duplicate call IDs reported complete; result-before-call reported complete.

GREEN: same command exit 0 — 15 tests; `pnpm typecheck` exit 0. Extra: planner + fault/runtime + invariants 17/17.

Implemented: ArchiveBranch walks `parentId` from leaf (cycle/missing → no new fold). ActiveView maps outbound toolResult by callId + content fingerprint; summarized-out `r` is not a field. `collectBatches` is one branch-order scan; duplicate call IDs / result-before-call / illegal result mark incomplete. `planFold` iterates `view.fields` and keeps previous keys only if they still map. `applyContext` P01: archive 80k + active tail → foldEvents=0, lastApplied=0, default 60/40/4/4096 unchanged. Sibling later compact is not the current boundary. Active `r2` FieldRef still reads original bytes. Eight active 8k results still fold `r1` (path not disabled).

Not run: `pnpm check`, smoke, live, remote Actions.

## R03

Changed: `src/projection/witness.ts`, `src/projection/render.ts`, `src/plugin.ts`, `src/pi/adapter.ts`, `src/pi/source-reader.ts`, `test/unit/request-witness.test.ts`, `test/host/balanced-wire.test.ts`, `test/helpers/controlled-provider.ts`, `docs/iterations/next-fixes.md`

`source-reader.ts` and `controlled-provider.ts` are outside the R03 file list. Official `getEntries()` omits the session header that is still `parentId` of the first real entry; without `includeHiddenAncestors` via `getEntry`, ArchiveBranch reported `missing-parent` and host never planned. Controlled `streamSimple` now reports usage at least 65% of the window so the first successful assistant does not drop `getContextUsage` below trigger. `onPayload` is invoked so `before_provider_request` actually observes the wire.

RED: `pnpm exec vitest run test/unit/request-witness.test.ts test/host/balanced-wire.test.ts test/host/observe-identity.test.ts --config vitest.config.ts` — missing tracker; host second turn still raw (no witness / session header / usage drop / failed pending treated as concurrent).

GREEN: same command exit 0 — 16 tests; `pnpm typecheck` exit 0.

Implemented: in-memory `RequestWitnessTracker`; context prepares still-visible original hashes; `before_provider_request` observe-only OpenAI tool messages; ACK only on assistant `stop`/`toolUse` with a response id or usage. `prepare` supersedes same-session unaccepted pendings so an `error` turn does not block the next serial `markSent`. `setProfile` recomputes `configHash` and fences. `session_compact` fences even when `willRetry`; count increments only when not retrying. Candidate plans trial-render first; `applied=0` does not `recordFold`. Host: first successful wire keeps originals; later successful turn folds old exposed results; error then success then fold; isError and unexposed last batch stay original.

Not run: `pnpm check`, smoke, live, remote Actions.

## Remaining

R04–R10 not started.
