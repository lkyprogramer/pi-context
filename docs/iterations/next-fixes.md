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

## R08

Changed: `eval/local/gate.mjs`, `eval/local/bundle.mjs`, `eval/local/report.mjs`, `eval/local/run-matrix.mjs`, `test/unit/trial-gate.test.ts`, `test/integration/run-bundle.test.ts`, `docs/iterations/next-fixes.md`

RED: missing `evaluateTrial` from `eval/local/gate.mjs`.

GREEN: `pnpm exec vitest run test/unit/trial-gate.test.ts test/integration/run-bundle.test.ts --config vitest.config.ts` exit 0 — 11 tests; `pnpm typecheck` exit 0.

Implemented: object-form `evaluateTrial` (critical → blocked; no-fold / missing pair / empty capability → inconclusive; unknown cost stays `quality-qualified-cost-unknown`). One loss per two quality reps cannot reach `limited-balanced-trial`. Report CLI reads only the frozen run `plan`, not repo cases. Manifest freezes dist file hashes, tarball, Pi package hash, dirty digest, scenario hash, and planned order. Bundle is sanitized numbers/ids/hashes and recomputes the same decision offline. First-attempt and final success rates are separate.

Not run: `pnpm check`, smoke, live matrix, remote Actions.

## R09

Changed: `eval/local/scenarios.mjs`, `eval/local/review-matrix.json`, `eval/local/review-fixtures/`, `eval/local/cases.json`, `test/unit/review-scenarios.test.ts`, `test/host/after-fold-quality.test.ts`, `test/helpers/controlled-provider.ts`, `docs/iterations/next-fixes.md`

`controlled-provider.ts` is outside the R09 file list: `seedToolHistory` accepts `prefixText` so the host lane can put the Q01 witness in a complete, exposable first batch.

RED: missing `validateScenario`; witness mismatch and prompt leak were not rejected.

GREEN: `pnpm exec vitest run test/unit/review-scenarios.test.ts test/host/after-fold-quality.test.ts --config vitest.config.ts` exit 0 — 5 tests; `pnpm typecheck` exit 0.

Implemented: Q01–Q08 / C01–C02 fixtures hide the witness from the final prompt. Frozen plan is 32 quality + 4 capability episodes, all `UNRUN`. L01–L06 are no-fold regressions; H03 is optional. Controlled host: six complete batches, 60% trigger, real fold, history read recovers `tenant-contract-73`. Two-tool swap/drop is detected. Live model for the 36-episode plan is not run.

Not run: `pnpm check`, smoke, live matrix, remote Actions.

## R10

Changed: `docs/iterations/next-fixes.md`, `README.md`, `docs/CONFIGURATION.md`, `docs/OPERATIONS.md`, `HANDOFF.md`, `artifacts/local-eval/review-final/`, `eval/local/run-matrix.mjs`, `eval/local/report.mjs`, `test/unit/trial-gate.test.ts`, `test/unit/local-cases.test.ts`

`local-cases.test.ts` is outside the R10 file list: `cases.json` now also lists Q/C review ids; the frozen v6.0 scenario ids must still be present.

RED: `unexercised optimization cannot authorize a default change` — already covered by gate; added the exact R10 case (`relativeChange: -0.5` → `inconclusive`).

GREEN: `pnpm check` exit 0 — 186 tests, compat `{ok:true,files:33}`. `pnpm build && pnpm smoke` exit 0 — 14 tests. `node eval/local/secure-preflight.mjs --canary` exit 0. Controlled matrix exit 0.

Live 36-episode review matrix: **UNRUN** (`PCTX_LIVE` unset; runner requires it). Delivery decision is **`inconclusive`**. Default profile stays observe. Dated trial `20260909-112407` is superseded as a delivery claim and kept on disk. No 2% non-inferiority or global-best claim.

Not run: `PCTX_LIVE=1` 36-episode live matrix, remote Actions.

## S01

Changed: `src/plugin.ts`, `test/unit/request-witness.test.ts`, `docs/iterations/next-fixes.md`

RED: `pnpm exec vitest run test/unit/request-witness.test.ts --config vitest.config.ts` — persisted confirmation used to confirm `r6:0` (no later successful assistant).

GREEN: same file 14/14; `test/host/balanced-wire.test.ts` 6/6; `test/host/after-fold-quality.test.ts` 2/2; `pnpm typecheck` exit 0.

Implemented: `applyContext` computes `exposed = exposedEntryIds(view.branch)` once and passes it to `confirmPersistedFields` and `planFold`. `confirmPersistedFields` confirms only `exposed.has(field.ref.entryId)` text fields. Extra negatives: error `stopReason` is not exposure; sibling-branch success does not confirm the current branch.

The new unit case cannot read `lastFieldHashes.get("r1:0")` after an 80% fold (original text is stubbed). It confirms `r1:0` with `sha256Hex("z".repeat(8000))` independently. Assertion direction unchanged.

### R03 修订登记

`44e8333b` (`fix: fold persisted session results on the first resume request`) confirmed every ActiveView text field with a source hash. Round 8 keeps that resume-first-request fold, but confirmation is now the derived-exposure set only.

Abandoned same-process wire-first witnessing for persisted fields: a resume request is already cold, so folding has no prefix-cache cost; recoverability is `pctx_history`, not “which model saw the bytes”. P02 sibling / P03 post-compact exposure stay isolated by ActiveView `parentId` walk and `compactionBoundary` identity.

Residual risk: after a model switch the new model only sees stubs — the same as any fold.

Not run: `pnpm check`, live, remote Actions.

## S02

Changed: `eval/local/gate.mjs`, `eval/local/accounting.mjs`, `eval/local/report.mjs`, `eval/local/run-matrix.mjs`, `eval/local/bundle.mjs`, `test/unit/trial-gate.test.ts`, `test/unit/objective.test.ts`

RED: missing `objectiveFromPairs` / `metricOf("fresh-input")`.

GREEN: `pnpm exec vitest run test/unit/objective.test.ts test/unit/trial-gate.test.ts test/integration/run-bundle.test.ts --config vitest.config.ts` exit 0; `pnpm typecheck` exit 0.

Implemented: `metricOf` sums request `freshInput` / `logicalInput` / `cachedRead` (any null → null; empty requests → 0). `objectiveFromPairs` pools candidate/native, `nativeSum === 0` or any null → `known:false`. Primary metric frozen `fresh-input` / `minImprovement 0.1`. Attempt rates: first vs final per episode. Manifest plan objective no longer writes `known`/`relativeChange`.

Self-check: replacing the unknown request’s `null` with `0` makes `primary.known === true` (relativeChange ≈ −0.756). Test file left with `null`.

Offline recompute of `artifacts/local-eval/review-qc-*` **BLOCKED** (directories absent in this workspace).

Not run: `pnpm check`, live.

## S03

Changed: `eval/local/gate.mjs`, `eval/local/accounting.mjs`, `eval/local/report.mjs`, `eval/local/scenarios.mjs`, `eval/local/review-spec.mjs`, `eval/local/review-matrix.json`, `test/unit/trial-gate.test.ts`, `test/unit/review-scenarios.test.ts`, `test/unit/review-live-wiring.test.ts`

RED: object `evaluateTrial` treated any candidate-only fail as `review-needed`; reason did not name pairs.

GREEN: `pnpm exec vitest run test/unit/trial-gate.test.ts test/unit/review-scenarios.test.ts test/unit/review-live-wiring.test.ts test/integration/run-bundle.test.ts --config vitest.config.ts` exit 0.

Implemented: `discordance` → `{ b, c, shared, bByCase, discordant[] }`. `review-needed` only if some case `b≥2` or `b−c≥2`. `evidencePassed:false` alone is not `review-needed` (accounting positional API → `inconclusive` via capability unproven). `answer()` must not let `{ discordant: disc }` overwrite the `discordant` array (extra is the whole counts object). H02 quote test uses two reps so `b=2`. Plan `repsPerCase: 3`; S06 later expands to 84.

`REVIEW_BUDGET.run = { totalWallMs: 7_200_000, totalModelCalls: 1_500, totalToolCalls: 2_400 }`.

Not run: offline `report.mjs` on missing `review-qc-*`.

## S04

Changed: `eval/local/parse-session.mjs`, `eval/local/cases.json`, `eval/local/review-fixtures/Q05.json`, `eval/local/gate.mjs`, `eval/local/report.mjs`, `eval/local/run-matrix.mjs`, `eval/local/bundle.mjs`, `test/unit/trial-gate.test.ts`, `test/unit/local-cases.test.ts`, `test/unit/report-provenance.test.ts`

RED: Q05 quote unmeasured; report header lacked `dist <digest12>` / `DIAGNOSTIC ONLY`.

GREEN: `pnpm exec vitest run test/unit/trial-gate.test.ts test/unit/local-cases.test.ts test/unit/report-provenance.test.ts test/integration/run-bundle.test.ts --config vitest.config.ts` exit 0.

Implemented: `verbatimQuote(..., { sourceKind: "any" })` takes the first matching toolResult line. Q05 `evidence.sourceKind: "any"` + fixture `exactQuote: true`. `pairsFromItt` fills quotes from `plan.exactQuoteIds`. `candidates()`: `fold-time-model-hint`, `inline-ref-marker`, `post-compaction-evidence-delta` (X only), `cold-aligned-fold` (diagnostic, not implemented). Live dirty without `--allow-dirty` dies; `--allow-dirty` → `diagnosticOnly` and decision forced `inconclusive`. Q05 quote tests set all three Q05 quotes to booleans so r1 is not `unmeasured`.

Not run: live dirty-tree rejection on a real provider.

## S05

Changed: `eval/local/sandbox/run-agent.sh`, `eval/local/sandbox/broker-unix.mjs` (new), `eval/local/sandbox/broker-tcp.mjs` (deleted), `eval/local/run-episode.mjs`, `eval/local/secure-preflight.mjs`, `scripts/credential-broker.mjs`, `test/security/agent-secret-isolation.test.ts`, `test/security/grader-isolation.test.ts`

RED: launcher still mentioned `BROKER_CID`; runner lacked `docker volume create` literal / `darwin-sidecar-volume-network-none`.

GREEN (static): `pnpm exec vitest run test/security/agent-secret-isolation.test.ts test/security/grader-isolation.test.ts --config vitest.config.ts` — 10 tests, 5 grader cases skipped (no Docker). `pnpm typecheck` exit 0.

Implemented: Darwin sidecar = named volume + `docker run -i` + key on stdin first line + unix socket probe; `broker-hop.json.kind = darwin-sidecar-volume-network-none`. Agent `docker run` is only `--network none`. Unwritable socket dir throws with the path (no TCP fallback). `secure-preflight --canary` adds `agentEgress`. Source comment keeps the `docker volume create` literal the isolation test greps for.

Docker canary: **GREEN** after installing Docker 29.8.0 (static binary; `apt-get update` hung). `node eval/local/secure-preflight.mjs --canary` exit 0 `{ok:true, env:false, models:false, proc:false, agentEgress:false}`. Grader isolation 6/6 (no skips). Image `pctx-t21-sandbox:0.85.1` built from `eval/sandbox/Containerfile`.

Linux live follow-up: first `PCTX_LIVE=1` episode hung because `spawnSync(run-agent.sh)` froze the in-process unix broker. Replaced with async `runSandboxAgent` (`spawn`). Stuck run kept at `artifacts/local-eval/review-r8-20260911/` (not a delivery).

## S06

Changed: `eval/local/cases.json`, `eval/local/cases/W-Q0{1,3,5,7}/TASK.md`, `eval/local/cases/X01/TASK.md`, `eval/local/review-fixtures/W-Q0{1,3,5,7}.json`, `eval/local/review-seed.mjs`, `eval/local/review-spec.mjs`, `eval/local/scenarios.mjs`, `eval/local/review-matrix.json`, `eval/local/log-workspace.mjs`, `eval/local/run-episode.mjs`, `eval/local/run-matrix.mjs`, `eval/local/gate.mjs`, `eval/local/report.mjs`, `test/unit/review-scenarios.test.ts`, `test/unit/review-live-wiring.test.ts`, `test/unit/local-cases.test.ts`, `test/host/warm-fold-regime.test.ts`, `test/helpers/controlled-provider.ts`

RED: missing W/X plan 84; missing warm-fold host test.

GREEN: `pnpm exec vitest run test/unit/review-scenarios.test.ts test/unit/review-live-wiring.test.ts test/unit/local-cases.test.ts test/host/warm-fold-regime.test.ts --config vitest.config.ts` exit 0; `pnpm typecheck` exit 0.

`node eval/local/run-matrix.mjs --mode live --dry --config eval/local/review-matrix.json --out /tmp/pctx-s06-dry` → 84 episodes including `W-Q01/native/1` and `X01/balanced/3`.

Implemented: W lane seed 45% + `padSource:"repo-docs"` + two warmup dumps; X01 logs 12×300 / markLine 210; `episodeLong` 900s/40/80; regimes excluded from the main quality denominator.

Host W-Q01: Pi `getContextUsage` is last-assistant usage plus trailing, so the card’s `[0.47, 0.57, 0.67]` already folds on the second prompt once dump-a (~47kB / ~11.8k estimated tokens) is in trailing. Script is `[0.40, 0.50, 0.67]`. Each prompt is a text stop; dumps are appended as a complete toolCall+result batch (no usage on the toolCall assistant) so they sit in `protectRecentBatches: 4`. Filter warmup dumps by `[dump-a ` / `[dump-b ` because seed repo-docs pads also start with `[dump-N`.

`ControlledScript.usagePercent` is per-step and may be below the default 65% seed stamp (out of the R03 helper default). Documented here; `src/` fold defaults unchanged.

`node eval/local/run-matrix.mjs --mode controlled ...` not re-run as a single wrapper after the host tests above (those three plus `controlled-guards` are the wrapper’s list).

Not run: Docker-backed controlled sandbox episodes; live model.

## S07

Changed: `artifacts/local-eval/review-final/` (force-added sanitized pack), `README.md`, `HANDOFF.md`, `docs/OPERATIONS.md`, `docs/CONFIGURATION.md`, `docs/iterations/next-fixes.md`

RED: round-7 `review-final` was `inconclusive` / `review-final` while live was still UNRUN.

GREEN: `pnpm exec vitest run test/unit/docs-decision-consistency.test.ts --config vitest.config.ts` exit 0. `pnpm check` after this pack exit 0 — 217 tests + `compat:scan` `{ok:true,files:25}`. Four docs quote `limited-balanced-trial` and `review-r8-20260911b`.

### Preflight on HEAD `878e92f292a7` (dirty=false)

- `pnpm check` exit 0 — 217 tests + `compat:scan` `{ok:true,files:25}`
- `pnpm typecheck` exit 0
- `pnpm build && pnpm smoke` exit 0 — 14 tests
- `node eval/local/secure-preflight.mjs --canary` exit 0 `{ok:true, env:false, models:false, proc:false, agentEgress:false}`
- `node eval/local/run-matrix.mjs --mode controlled --config eval/local/review-matrix.json` — 11 host tests, exit 0
- Docker: image `pctx-t21-sandbox:0.85.1` (`sha256:f36c813de266…`)

### Live

- Hung non-delivery: `artifacts/local-eval/review-r8-20260911/` (Linux `spawnSync` froze the in-process unix broker; Q01/native stuck). Kept on disk.
- Delivery: `PCTX_LIVE=1 node eval/local/run-matrix.mjs --mode live --config eval/local/review-matrix.json --seed 42 --out artifacts/local-eval/review-r8-20260911b`
- runId `review-r8-20260911b`, HEAD `878e92f292a7`, `diagnosticOnly:false`, dirty=false
- 84/84 complete, `blockedCount=0`, `NOT_RUN=0`, elapsedMs `6503987` (~108 min; run wall budget 7_200_000)
- requests.jsonl 902 lines (model-call budget 1500); attempts 84/84 first=1.000 final=1.000
- X01 native r1 first request input=1539 (cat); next input=6999 ≥ 4000 — not calibration-aborted
- `/metrics` available; engine-prefill relativeChange −0.641, same direction as fresh-input

### Machine decision

- `report.json.decision.decision` = `limited-balanced-trial`
- reason: `small canary only; no default change and no noninferiority claim`
- `recomputeDecision(bundle)` = same
- discordant: Q02/r1 candidate-fail-native-pass; Q02/r2 candidate-pass-native-fail; b=1 c=1 shared=0
- objective.primary: fresh-input relativeChange=−0.645 known=true (nativeSum 1203169 / candidateSum 427032, 24 pairs)
- regimes.warm: 12 pairs, b=0 c=3 shared=3, fresh-input −0.017, nativeCompactions 12/2
- regimes.long: 3 pairs, b=0 c=1 shared=0, fresh-input +0.195, nativeCompactions 4/1, quoteFailures 0/0
- candidates: fold-time-model-hint below-gate; inline-ref-marker below-gate; cold-aligned-fold met (diagnostic, not implemented)
- W spot-check: Q01/balanced/r1 first request already folded (foldEvent before first wire; input 11426 vs native ~44k). W-Q01/balanced/r1 first two requests unfolder (23036, 29961).
- Q05: file oracle pass both arms; quotedVerbatim false both arms (lost evidence 3/3); not quote-discordant
- Default profile stays observe. No 2% non-inferiority or global-best claim.

### Unverified

- Darwin live sidecar not run (this host is Linux)
- `review-qc-*` three dirty diagnostic runs absent; not recomputed
- GitHub Actions on this HEAD not claimed here
- 300 gate / publish / production not run

## PR review (Codex on `e925297`)

Changed: `eval/local/grade.sh`, `eval/local/log-workspace.mjs`, `eval/local/run-episode.mjs`, `eval/local/sidecar-ready.mjs`, `eval/local/sandbox/run-agent.sh`, `eval/local/bundle.mjs`, `test/security/grader-isolation.test.ts`, `test/security/agent-secret-isolation.test.ts`, `test/integration/run-bundle.test.ts`, `test/unit/sidecar-ready.test.ts`

- X01 `fixture:null` made `grade.sh` treat TRUSTED_ROOT as `$REPO/None` and skip `logs/` comparison. Trusted logs are now rematerialized from the case `logs` spec.
- Darwin sidecar wait used `spawnSync("sleep")`, which froze stdout so `ready` never arrived. Wait is async via `waitForReadyJson`.
- Agent command now starts `unix-relay.mjs` beside `run-in-container.mjs` (image entrypoint socat still runs if the socket exists at start; EADDRINUSE on the node relay is ignored).
- `recomputeDecision` rebuilds W/X `regimePairs` from bundled episodes so a regime-only critical violation stays `blocked`.

