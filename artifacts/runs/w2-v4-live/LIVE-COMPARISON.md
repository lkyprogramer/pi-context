# W2/W5 Live Comparison (current-head continuation)

## Scope

- Repository: `pi-context`
- Runtime: Pi `0.84.4`, Node `v22.19.0`
- Provider/model: `openclaw` / `openclaw/Qwen3.8-27B-WORK`
- Context window: `200192`
- Run profiles: C25 `natural`
- Output roots: `artifacts/runs/w2-v4-live` and `artifacts/runs/w2-v5-live`

## Observed evidence

- The Native arm produced 21 turns in `w2-v4-live/natural-threshold/large-turn-native.partial.json`.
- Native turn 20 recorded `compactCount=1` and `tokensBefore=189191`; this is direct evidence of one Host compaction event near the configured threshold.
- The PCR arm produced 9 turns in `w2-v4-live/natural-threshold/large-turn-pcr.partial.json` but no completed lane report.
- A second run using the isolated `w2-v5-live` root was stopped after prolonged no-progress observation; it did not produce a final report.
- A bounded one-turn Provider smoke in `w2-v6-live` completed all four natural-threshold arms (`large-turn-native`, `large-turn-pcr`, `tool-heavy-native`, `tool-heavy-pcr`) with `ok=true`; it produced no compaction or terminal lane report.
- A bounded three-turn Provider run in `w2-v7-live` completed a terminal natural-threshold report with `liveProvider=true` and `providerStarted=true`. It recorded `triggered=false` and `compactCount=0`; B0 failed closed with `host-auto-compact-missing` and B2 with `materialization-unbounded`.

## Claims deliberately not made

- No C25 pass claim: B2 bounded-materialization and complete behavior were not demonstrated.
- No C26/C27/C28 live claim: those lanes were not completed in this run.
- No publication claim: `publicationClaim=false` remains the governing decision.
- No 300-pair gate was started; it remains deferred until all development tasks and evidence are complete.
- The v6 smoke is connectivity/RPC evidence only and is not a C25 acceptance result.
- The v7 result is runner/Provider completion evidence only; it is not a C25 acceptance result because the natural pressure and bounded-materialization criteria were not observed.
- A v8 overflow attempt entered the grow phase and exceeded the intended bounded-turn smoke window; it was interrupted after partial native evidence (at least turns 0-8) and produced no recovery report. The partial/session files are retained; this is not an overflow acceptance result.
- After bounding overflow grow turns, a v9 overflow run completed both Native and PCR grow phases at exactly turns 0-2 and produced a terminal report. Provider overflow was not observed (`overflowObserved=false`), so recovery was skipped and the lane correctly exited non-zero; this is runner-boundary evidence, not C26 acceptance.
- A v13 recursive-auto smoke using the bounded 2000-character filler produced no partial/report within the observation window and was interrupted at about 100 seconds; no post-fix branch/restart claim is made.
- A v14 recursive-auto smoke after `62d171c` used the bounded 1000-character filler and reached a terminal report. Fork evidence passed (`forkEvidence.ok=true`, `branched=true`, `branchPointerVerified=true`, `correctionVerified=true`); restart continuity and the three-compaction requirement still failed (`restarted=false`, `compactCount=0`), so C27/C28 remain fail-closed and no acceptance claim is made.
- A v15 recursive-auto smoke after the cross-session lineage fix reached a terminal report with `restarted=true`, `restartContinuityVerified=true`, `forkEvidence.ok=true`, and `branchLineage.ok=true`. Provider behavior still failed correction/compaction assertions (`correctionVerified=false`, `compactCount=0`), so this remains diagnostic evidence rather than C28 acceptance.
- A v17 bounded natural-threshold run reached Native turn 19 at `billedTokens=182579` (near the `183808` trigger threshold) without a recorded compaction; the next Provider request stalled and the process was interrupted. Native/PCR partials are retained and no C25 pass claim is made.
- A v18 bounded overflow smoke completed Native/PCR growth and the overflow prompt with `overflowObserved=false`; recovery was correctly skipped (`recoveryOk=true`, `compactThenRetry=false`). This confirms bounded runner behavior only and is not C26 acceptance.

## Failure/stop classification

The v4/v5 runs reached a real Pi RPC child and wrote session/partial evidence, but did not reach a terminal report within the observation window. The v6 smoke also stopped at partial evidence. The v7 bounded run did reach a terminal report, but its fail-closed lane result is still not complete Evidence v3. All partial files are retained for diagnosis.
