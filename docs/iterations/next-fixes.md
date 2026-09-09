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

## R04

Changed: `src/history/page-snapshots.ts`, `src/history/search.ts`, `src/history/read.ts`, `src/plugin.ts`, `test/unit/history-pagination.test.ts`, `test/host/history-pagination.test.ts`, `test/integration/search.test.ts`, `test/security/injection.test.ts`, `test/unit/history-budget.test.ts`, `docs/iterations/next-fixes.md`

`plugin.ts` is in the R04 file list (snapshot store on the extension instance; fence clears snapshots). Callers of `searchHistory` now pass `snapshots` + `configHash`. Query/branch mismatch is `stale-cursor` instead of auto-reset to page 1.

RED: required `read cursor is bound to a specific field` — formatted content omitted `nextCursor`; a cursor from field `a` applied to field `b` by byteOffset only.

GREEN: `pnpm exec vitest run test/unit/history-pagination.test.ts test/host/history-pagination.test.ts test/host/history-image.test.ts --config vitest.config.ts` exit 0 — plus budget/search/injection/history-read 12/12; `pnpm typecheck` exit 0.

Implemented: `SearchSnapshotStore({maxSnapshots:16,maxHits:128,ttlMs:600000})`. Search freezes ≤128 authorized refs; cursor is snapshotId+nextOffset+scope. Leaf advance keeps a live ancestor; sibling/query/config/TTL/restart → `stale-cursor`. Read cursor binds full FieldRef+hash+kind+byteOffset. `formatHistoryResult` writes `nextCursor` into model-visible JSON. Host observe session: search p1 → search p2 → read p1 → read p2 using only tool `content`. Image read still returns a native image block.

Not run: `pnpm check`, smoke, live, remote Actions.

## R05

Changed: `src/history/index.ts`, `src/plugin.ts`, `src/pi/adapter.ts`, `src/history/scope.ts` (import only via plugin), `test/unit/index-capacity.test.ts`, `docs/iterations/next-fixes.md`

`adapter.ts` is outside the R05 file list: `session_start` now passes `cwd` into `openSessionIndex` so HOME/root `persist=false` forces memory-only.

RED: `duplicate rows do not consume insertion headroom` — rescan of `a` charged 100 bytes again (`used+byteLen > 150`) and never inserted `b`.

GREEN: `pnpm exec vitest run test/unit/index-capacity.test.ts test/integration/index.test.ts test/host/index-restart.test.ts --config vitest.config.ts` exit 0 with history-index-scope 12/12; `pnpm typecheck` exit 0.

Implemented: identity lookup before quota; process cache skips re-hash of known entry ids; leaf-unchanged upsert is 0 hashedFields; hash conflict is `source-changed` and does not overwrite. `status()` reports `newRows/newBytes/scannedIds/hashedFields` and logical `bytes` vs diagnostic `physicalBytes`. Search SQL failure throws `INDEX_UNAVAILABLE` (degraded), not empty ok. Persistent reopen still inserts 0 for the same leaf.

Not run: `pnpm check`, smoke, live, remote Actions.

## R06

Changed: `eval/local/sandbox/run-agent.sh`, `eval/local/run-episode.mjs`, `eval/local/grade.sh`, `eval/local/secure-preflight.mjs`, `eval/sandbox/broker-main.mjs`, `eval/sandbox/relay.ts`, `eval/sandbox/unix-relay.mjs`, `eval/local/run-matrix.mjs`, `eval/local/cases.json`, `scripts/credential-broker.mjs`, `test/security/agent-secret-isolation.test.ts`, `docs/iterations/next-fixes.md`

Outside the R06 file list: `scripts/credential-broker.mjs` now enforces `allowedToken`, denies `/metrics`, and applies body/timeout limits; `unix-relay.mjs` is the container HTTP→Unix hop; `run-matrix.mjs` no longer passes `--no-sandbox`; H03 `cases.json` `sandbox` is true so the matrix matches the runner.

RED: `agent launcher does not materialize provider credentials` — comment still contained `--network bridge`.

GREEN: `pnpm exec vitest run test/security/agent-secret-isolation.test.ts test/security/grader-isolation.test.ts --config vitest.config.ts` exit 0 — 9 tests; `pnpm typecheck` exit 0.

Implemented: parent `startCredentialBroker` holds the upstream key; agent `models.json` only gets a per-run opaque token and `http://127.0.0.1:8080/v1`. `run-agent.sh` is `--network none`, no `.env`, no host path. `--no-sandbox` and `runOnHost` are removed. Grader stays `--network none` without the broker socket; union walk flags unauthorized extras and deletions. `secure-preflight --canary` reports booleans + canary hash only.

`node eval/local/secure-preflight.mjs --canary` exit 0 — `{ok:true,env:false,models:false,proc:false,net:true}`. Docker canary passed on this machine; live provider still waits for R10.

Not run: `pnpm check`, smoke, live matrix, remote Actions.

## R07

Changed: `eval/local/accounting.mjs`, `eval/local/parse-session.mjs`, `eval/local/run-episode.mjs`, `eval/local/run-matrix.mjs`, `src/telemetry/usage.ts`, `src/pi/adapter.ts`, `src/contracts.ts`, `eval/local/sandbox/run-in-container.mjs`, `test/unit/request-accounting.test.ts`, `docs/iterations/next-fixes.md`

`contracts.ts` and `run-in-container.mjs` are outside the R07 file list: RequestRecord gained requestId/purpose/hookToFirstDeltaMs; the container runner is the only live `requests.jsonl` writer after R06 removed host execution.

RED: missing `normalizeUsage` / `median` / `aggregateAttempts` from `eval/local/accounting.mjs`.

GREEN: `pnpm exec vitest run test/unit/request-accounting.test.ts --config vitest.config.ts` exit 0 — 16 tests; extra economics+eval-accounting 33/33; `pnpm typecheck` exit 0.

Implemented: Pi-disjoint does not subtract cacheRead; logical = input+cacheRead+cacheWrite; raw inclusive rejects prompt 10 / cache 20. Failed attempts stay in the ledger; missing retry usage makes `logicalInput` null and keeps `knownLogicalSubtotal`. Same requestId dedups; distinct ids with identical content each count. `message_end` records assistants only; native compact usage is `purpose=compaction`. Adapter writes `hookToFirstDeltaMs` and leaves `ttftMs` null (no send timestamp). Engine deltas stay separate from Pi logical. `attempts.jsonl` is append-only; `result.json` is the final summary.

Not run: `pnpm check`, smoke, live matrix, remote Actions.

## Remaining

R08–R10 not started.
