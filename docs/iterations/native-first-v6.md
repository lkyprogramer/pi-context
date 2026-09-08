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

## Task: C02
Commit: 074cb2263e3d077099def7955d9054af79ef2b28
Changed: src/projection/exposed.ts, src/projection/batches.ts, src/pi/source-reader.ts, src/contracts.ts, test/unit/derived-exposure.test.ts, test/unit/batches.test.ts
RED: `pnpm exec vitest run test/unit/derived-exposure.test.ts --config vitest.config.ts` failed to load `src/projection/exposed.js`
GREEN: `pnpm exec vitest run test/unit/derived-exposure.test.ts test/unit/batches.test.ts --config vitest.config.ts` exit 0 — 8 tests; `pnpm typecheck` exit 0; full `pnpm exec vitest run --config vitest.config.ts` exit 0 — 92 tests
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: fold still returns null until C03; protectSet keeps result entry ids only; K=0 protects none of the last complete batches

## Task: C03
Commit: d99cc1677463d4fdcfdb06f2cc7bc82940ba140d
Changed: src/projection/planner.ts, src/projection/render.ts, src/projection/budget.ts, src/plugin.ts, src/pi/adapter.ts, src/pi/source-reader.ts, src/telemetry/usage.ts, src/telemetry/metrics.ts, src/commands.ts, src/config.ts, src/contracts.ts, test/unit/fold-plan.test.ts, test/unit/render.test.ts, test/unit/planner.test.ts, test/property/invariants.test.ts, test/unit/budget.test.ts, test/fault/runtime.test.ts, test/packed/install.test.ts
RED: `pnpm exec vitest run test/unit/fold-plan.test.ts --config vitest.config.ts` — `shouldFold is not a function`
GREEN: `pnpm exec vitest run test/unit/fold-plan.test.ts test/unit/render.test.ts test/unit/planner.test.ts test/property/invariants.test.ts --config vitest.config.ts` exit 0 — 14 tests; `pnpm typecheck` exit 0; full vitest 95 passed
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (not on PATH) / not-run
Remaining: defaults trigger=60 target=40 protectRecentBatches=4 minRemoved=4096 minFoldable=1024 stubHeadChars=120; planFold keeps folding after target until minRemoved is met so the C03 fixture can produce a plan; `/pctx fold` still respects triggerPercent inside planFold; D01 live smoke not run

## Task: D01
Commit: 355536943be1c7f50025807515b15128438b2f55
Changed: test/helpers/controlled-provider.ts, test/helpers/official-pi.ts, test/host/balanced-wire.test.ts, test/host/observe-identity.test.ts, test/packed/install.test.ts, package.json, docs/iterations/native-first-v6.md
RED: `pnpm exec vitest run test/host/balanced-wire.test.ts --config vitest.config.ts` — captured messages had no `toolResult` because `SessionManager.appendMessage` after `createAgentSession` does not update `agent.state.messages`
GREEN: `pnpm smoke` exit 0 — 12 tests; `pnpm typecheck` exit 0
Host/model: pi 0.85.1 from `node_modules/@earendil-works/pi-coding-agent` (`pi` not on PATH) / not-run
Remaining: host tests disable Pi auto-compaction (`enabled: false`, `keepRecentTokens: 256`) so threshold fold can be observed; seed final assistant `usage.totalTokens` is 65% of `contextWindow` because `getContextUsage` is usage-backed; `scripts/packed-host.mjs` already emitted tarball sha256; `dist/extension.js` sha256 `34dfcba7da19394c47391f746f13459160793e2a9c205f8720a40b25b02b8f19`; Node v22.17.0 vs engines >=22.19.0

## Task: E01
Commit: d5355a7662b33d1189985be542a8b8d0fe851d31
Changed: eval/local/**, test/unit/local-cases.test.ts, test/fixtures/local-eval/sample-session.jsonl, docs/iterations/native-first-v6.md
RED: `pnpm exec vitest run test/unit/local-cases.test.ts --config vitest.config.ts` originally import-failed before `eval/local` existed; this landing re-ran GREEN
GREEN: `pnpm exec vitest run test/unit/local-cases.test.ts --config vitest.config.ts` exit 0 — 2 tests; `pnpm typecheck` exit 0
Host/model: tunnel to `hhtele@192.168.10.29:18343` — `Connection closed by 192.168.10.29 port 22`; `node eval/local/run-episode.mjs --case L04 --arm native --window w262k --rep 0 --out /tmp/pctx-e01-smoke` wrote `status: blocked` and did not start Pi; `metrics-snap.sh` wrote `available:false`; seed recording not-run
Remaining: live native L04 episode and `record-seed.mjs` need a working 4090 tunnel; E01 also copied `cases/H03/TASK.md` and `seeds/.gitkeep` beyond the card list so cases.json paths resolve; sandbox default is off until `eval/local/sandbox/run-agent.sh` exists; `pi` not on PATH so the runner reads 0.85.1 from workspace node_modules

## Task: E02
Commit: 2cb40298edcabfe986f4830703eba0e420a60aed
Changed: eval/local/grade.sh, eval/local/sandbox/run-agent.sh, eval/local/sandbox/run-in-container.mjs, eval/local/run-episode.mjs, eval/sandbox/Containerfile, eval/sandbox/build-image.mjs, eval/live-g4.mjs (deleted), test/security/grader-isolation.test.ts, eval/smoke.mjs, package.json, docs/iterations/native-first-v6.md
RED: `pnpm exec vitest run test/security/grader-isolation.test.ts --config vitest.config.ts` originally failed — macOS bash 3.2 `set -u` rejected empty `${SECRET_MOUNT[@]}`; `date +%s%3N` produced a non-numeric token so grade.sh exited 1 before writing grade.json
GREEN: `pnpm exec vitest run test/security/grader-isolation.test.ts --config vitest.config.ts` exit 0 — 5 tests; `pnpm typecheck` exit 0; `node eval/sandbox/build-image.mjs` status passed, imageId `sha256:3809a2e07c972fe485dc3be75d26da8fd614f6d822fdd3d0daca53cf22c186cc` (node 22.19.0 / pi 0.85.1 / git 2.39.5 / javac 17.0.20.1); L01–L06 `initial/` graded `passed=false`; L04–L06 KnownGood graded `passed=true`
Host/model: Docker 29.4.0 (OrbStack); tunnel to `hhtele@192.168.10.29:18343` — `Connection closed by 192.168.10.29 port 22`; `node eval/local/run-episode.mjs --case L04 --arm native --window w262k --rep 0 --out /tmp/pctx-e02-smoke` wrote `status: blocked` and did not start Pi; `--no-sandbox` on L04 blocked as required
Remaining: no live container Agent episode until the 4090 tunnel is up (grader isolation is proven; Agent path is not); Agent container may still egress beyond `host.docker.internal:18343` (known limit, Docker Desktop/OrbStack bridge); `eval/oracles/java.ts` and `eval/sandbox/isolation-probe.ts` still mention host `javac`; `eval/smoke.mjs` and `package.json` `eval:g4` were patched/removed because E02 deleted `live-g4.mjs`; `run-in-container.mjs` is beyond the card file list; E03 matrix not-run

## Task: E03
Commit: 6486703bc70a1e41dbe88739981774ff3ea44b33
Changed: eval/local/arm-contract.mjs, eval/local/report.mjs, eval/local/run-matrix.mjs, eval/local/run-episode.mjs, test/unit/eval-accounting.test.ts, eval/live-c2.mjs, eval/smoke.mjs, eval/report.ts, eval/runner.ts, package.json, .gitignore, docs/iterations/native-first-v6.md
RED: `pnpm exec vitest run test/unit/eval-accounting.test.ts --config vitest.config.ts` originally import-failed before `eval/local/report.mjs` existed; this landing re-ran GREEN
GREEN: `pnpm exec vitest run test/unit/eval-accounting.test.ts --config vitest.config.ts` exit 0 — 5 tests; `pnpm typecheck` exit 0; `pnpm eval:local -- --dry --out /tmp/pctx-dry` printed 37 episodes (AB/BA rotation, seed 42)
Host/model: live run `20260908-215433` against `openclaw/Qwen3.8-27B-WORK` at `http://47.106.205.246:1082/v1` (user override; `192.168.10.29:18343` still unreachable). `pnpm eval:local -- --resume artifacts/local-eval/20260908-215433` then `pnpm eval:report` exit 0. 37/37 `complete`. `{origin}/metrics` 404 → engine deltas unknown. `usage.cacheRead` always 0.
Remaining: see report. Seed `eval/local/seeds/java-three-nonce.jsonl` recorded locally (`.secret` gitignored). Live harness follow-up commit `68ce1f6689e905d27a5c264e0a3f7abf064155ac` — freeze `configHash` per arm; host plugin load via `additionalExtensionPaths` only; restore `HOME` before `grade.sh`; public model URL.

```text
decision: observe-only (failed gate: mechanism)
- H01 balanced never recovered the nonce through a verified read
candidates: none
```

Quality L01–L06 native vs balanced all 2/2 (wrong-action never higher on balanced). H01/H02 balanced 4/4 `folds>=1`. H01 nonce correct 2/2 on all three arms without `pctx_history` read. H03 complete, context ~20%, folds 0, native compactions 0.

## Task: E04
Commit: d28a3685ce245d1a4d270c02b9fac4ea785d49ca
Changed: docs/iterations/native-first-v6.md, README.md, docs/CONFIGURATION.md, docs/OPERATIONS.md, docs/release-v5.md, HANDOFF.md, package.json, test/packed/install.test.ts, test/host/stock-loader.test.ts
RED: `pnpm exec vitest run test/packed/install.test.ts --config vitest.config.ts` — README still named v5 surfaces / iterations lacked a decision line
GREEN: `pnpm smoke` exit 0 — 13 tests; `pnpm typecheck` exit 0; `pnpm exec vitest run --config vitest.config.ts` exit 0 — 115 tests
Host/model: same as E03; `pnpm build && node scripts/packed-host.mjs` → `pi-context-6.1.0.tgz` sha256 `a0cbf8b082a1e6d03e2bf779ef905ed60efd5d2753579a53bb6c894ef2f0c12b`




## Round decision

decision: observe-only

Evidence: run `20260908-215433`, E03 landing `6486703bc70a1e41dbe88739981774ff3ea44b33`, live harness `68ce1f6689e905d27a5c264e0a3f7abf064155ac`, Pi 0.85.1, plugin `34dfcba7da19394c47391f746f13459160793e2a9c205f8720a40b25b02b8f19`, model `openclaw/Qwen3.8-27B-WORK` thinking medium. Quality cells all passed. Balanced fold triggered on H01/H02 but never produced a verified history read; cacheRead and NInfer `/metrics` are unavailable here so the cost gate cannot pass either.

Limits: one model, one machine, n=2 per cell, public OpenAI-compat endpoint without prefix-cache accounting.

Next round only if: (1) H01 balanced recovers the nonce with `verifiedReads>=1`, (2) post-fold `cacheRead` or engine prefill is actually observed, (3) H03 usage reaches the 60% trigger. Do not retune fold parameters to chase a `limited-balanced-trial` on this dataset.

docs: record final sha — packaging commit `d28a3685ce245d1a4d270c02b9fac4ea785d49ca`




