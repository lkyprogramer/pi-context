# Current-HEAD live comparison (Native vs PCR)

**Do not treat this as a publication claim.** `publicationClaim=false`. Decision remains `keep-pi-native`.

This file is only for HEAD `d3025792e637b02bca683c625fa6a2ea3abbecf9` (`fix(runtime): split identity context from PCR recall materializer`) plus the uncommitted live-harness edits in `tests/live-gate/w5-live-lanes.ts` (billedTokens, threshold compact with `reason=null`, persistPartial, Native overflow arm, grow-before-compact-2). It does **not** mix `a6281b3` 100×3 numbers, older spec-smoke under `artifacts/runs/w2-live-native/**`, or `artifacts/runs/pcr-vs-pi-native/**`.

| Field | Value |
| --- | --- |
| Date | 2026-09-02 (W5 + spec-smoke); 2026-09-03 (100×3) |
| Provider / model | `openclaw` / `openclaw/Qwen3.8-27B-WORK` |
| Advertised window | `contextWindow=200192`, `maxTokens=16384` unmodified |
| Compact threshold | `200192 − 16384 = 183808` |
| Node | nvm `v22.16.0` (Pi RPC PATH also sees `v22.19.0`) |
| 100×3 | **ran, Hard FAIL** (`280/300` scored; `publicationClaim=false`) |

## 0. Verdict

| Claim | Result | Why |
| --- | --- | --- |
| Hermetic suite | **PASS** | unit 165 files / 768 tests; contract 10 / 34; acceptance 22 / 64; integration 13 / 27; all exit 0 |
| Natural 200k vs Native, default keepRecent=20000 | **NOT OBSERVED as SUCCESS** | `triggered=false`. Native tool-heavy compacted once at `tokensBefore=187164` (`reason=null`, `fromHook=false`). PCR never wrote a compaction JSONL; billed collapsed ~150–158k → ~9.5k |
| Provider overflow (autoCompact off) | **NOT OBSERVED** | Native peaked `billed=191621` then usage `0`; overflow-prompt still `ok`. PCR peaked `153801` then collapsed to `9547`. No `context_length` error. No hand-compact-as-overflow |
| Recursive ≥3 hand-compacts | **OBSERVED** on PCR after growing between compacts | 3 JSONL compaction rows; compact-2 was native fallback (`fromHook=false`) |
| W2 spec-smoke 30×1 Native vs identity vs PCR | **completed, Hard FAIL** | 30/30 same-cut; `hardGatePass=false`; `directiveCoverage` not 1; exact recovery `n/a` denominator 0; `keep-pi-native` |
| W2 100×3 | **completed as a live bundle, Hard FAIL** | 300 pairs attempted; gate scored `280/300` (20 arm timeouts); `hardGatePass=false`; `keep-pi-native` |
| Close NF014 / NF012 / NF013 / NF021 | **no** | see §6 |
| Flip `publicationClaim` | **no** | Hard fail; 280/300; recovery n/a; B1 not cheaper; natural/overflow still not observed |

## 1. Hermetic

Run log: `/var/folders/yt/10k_hqkn30x18d7lbn28_gnc0000gn/T/grok-goal-3664b8f137fb/implementer/hermetic-full.log`

| Layer | Test files | Tests | Exit |
| --- | ---: | ---: | --- |
| unit | 165 | 768 | 0 |
| contract | 10 | 34 | 0 |
| acceptance | 22 | 64 | 0 |
| integration | 13 | 27 | 0 |

That suite was run **before** the last W5 harness edits. After those edits, `tests/live-gate/w5-lane-policy.test.ts` was re-run: 2/2 pass.

## 2. Natural threshold (keepRecent=20000, reserve=16384, autoCompact on, no `rpc.compact()`)

Artifact: `artifacts/runs/w2-v3-live/natural-threshold/report.json`

| Family | Arm | Turns | Peak billed (`input+cacheRead`) | Compaction JSONL | Last billed | Notes |
| --- | --- | ---: | ---: | --- | ---: | --- |
| large-turn | Native | 22 | 190061 @ turn 20 | 0 | hang | turn 21 `prompt did not settle in 240000ms`; 190061 > 183808 but < 183808+8192 so mismatch flag did not fire |
| large-turn | PCR | 40 | 158048 @ turn 16 | 0 | 9550 | cacheRead 149161 → 679 at turn 17; session still has all messages |
| tool-heavy | Native | 20 | 186722 @ turn 19 | **1** | 186722 | `fromHook=false`, `reason=null`, `tokensBefore=187164`; continuation asked |
| tool-heavy | PCR | 40 | 149739 @ turn 15 | 0 | 9549 | same collapse pattern |

Lane-level: `liveProvider=true`, `manualCompact=false`, `triggered=false`, `compactCount=1`.

Pi compaction JSONL on this provider writes `reason=null`. The harness now counts `tokensBefore ≥ 183808` as threshold. Native tool-heavy meets that; PCR does not, so family `triggered` stays false.

PCR collapse is **not** a compaction event. After collapse the model sees ~8863 input + ~680 cache (one user filler turn), while `session.jsonl` keeps growing. That matches Host View / context-hook replacement, not Pi native compact.

## 3. Provider overflow (autoCompact **off**, no hand compact unless overflow)

Artifact: `artifacts/runs/w2-v3-live/overflow/report.json`

| Arm | Peak billed | After peak | overflow-prompt | `overflowObserved` | Hand compact |
| --- | ---: | --- | --- | --- | --- |
| Native | 191621 @ turn 20 | turns 21–24 usage all 0, still `ok` | `ok` (no throw) | false | skipped |
| PCR | 153801 @ turn 16 | collapse to 9547 from turn 17 | `ok` | false | skipped |

`usedManualCompactAsOverflow=false`. Policy did not invent overflow.

Native crossed the advertised compact threshold with autoCompact off and still did not get a provider `context_length` error. Zero-usage replies after 191k are recorded as-is; they are **not** counted as overflow.

## 4. Recursive long-horizon (hand `rpc.compact()`, PCR extension)

Artifact: `artifacts/runs/w2-v3-live/recursive/`

Attempt 1 (preserved `attempt-1-session-too-small.json`): compact-1 ok; temporal-update ok; compact-2 error `Nothing to compact (session too small)`. After keepRecent=20000, a short version-7 prompt is not enough to compact again.

Attempt 2 (harness grew `filler(80_000)` before compact-2):

| Phase | Result |
| --- | --- |
| compact-1 | ok, `fromHook=true`, `tokensBefore=30310` |
| compact-2 | ok, `fromHook=false` (native fallback), `tokensBefore=20254` |
| compact-3 | ok, `fromHook=true`, `tokensBefore=36816` |
| branched / restarted | true |
| sideEffectGuard | true (no “deployed successfully”) |
| `threeCompacts` | **true** |

This is **manual compact**, not natural 183808. Compact-2 falling through to native means PCR `prepareCompaction` is not a reliable 3-cycle hook.

## 5. W2 spec-smoke 30×1 (same-cut, keepRecent=**2048**)

This is **not** the 200k natural lane. Cut policy is the W2 same-cut pairing (`LIVE_KEEP_RECENT_TOKENS=2048`), shared across B0/B1/B2/F0.

Artifact: `artifacts/runs/w2-v3-live/paired-spec-smoke/`  
Hashes: report `7540dda8…`, gate-decision `d8546ea0…`  
Duration: ~1276 s.

| Gate field | Value |
| --- | --- |
| completed / expected | 30 / 30 |
| sameCut | 30 / 30 |
| armFailures | [] |
| B0 native / B1 fromHook / B2 fromHook / F0 ceiling | all true |
| B1==B2 compact summary text | **30 / 30 identical** |
| B0/B1/B2 firstKeptEntryId | 30 / 30 same as expected |
| `hard.directiveCoverage` | 0 (not every B1 row is 1; `ov-10` is 0) |
| B1 dir=1 | 29 / 30 |
| B2 dir=1 | 28 / 30 (`ov-08`, `ov-10`) |
| exact recovery | all arms `n/a`, denominator 0, `recovered=false` |
| `hardGatePass` | **false** |
| quality CI (B1−B0) | estimate/lower/upper all 0 |
| `tokenMedianRelativeDelta` | +0.0162 (B1 not cheaper) |
| `realizedNetMedian` | −98.5 |
| `costPerSuccessRelativeDelta` | +15.05 |
| overflow recovery B0 vs B1 | 0.833 vs 0.833 |
| decision | `keep-pi-native` |
| `publicationClaim` | false |
| sample vs W2 floor | spec-smoke 30×1, not 100×3 |

Checkpoint size: Native B0 summary median **397.5** tokens; B1/B2 summary median **24** tokens (22–26). Efficiency “win” from a 24-token checkpoint is not a Hard pass.

Probe input (post-compact materialize) is where identity (B1) and PCR (B2) actually diverge. Compact text does not.

| Family | B0 probe median | B1 identity probe median | B2 PCR probe median | B0 summary med | B1/B2 summary med |
| --- | ---: | ---: | ---: | ---: | ---: |
| tool-heavy | 7946.5 | 7999.5 | 515 | 488 | 24 |
| constraint | 468.5 | 4290 | 411 | 374.5 | 22 |
| temporal-update | 1327.5 | 381 | 515 | 382.5 | 26 |
| branch | 467 | 7992 | 515 | 350 | 24 |
| overflow | 500.5 | 7993.5 | 196.5 | 409.5 | 22 |

B1 probe is bimodal (~80–500 or ~7990–8000). B2 PCR stays in a narrow band (~80–526). Native B0 is family-dependent (tool-heavy ~8k, others ~500).

Phase P (identity vs pcr materializer) is live-visible on the **probe** path, not on the compact checkpoint. B1 and B2 still share one compact hook and one 24-token summary.

Closed-loop: temporal-update Native 0.333 vs B1/B2 1.0 on this 6-row slice. That is **not** a 100×3 quality CI, and Hard already failed.

## 5b. W2 gate 100×3 (same-cut, keepRecent=**2048**) — HEAD `d302579`

Artifact: `artifacts/runs/w2-v3-live/paired-gate/`  
`generatedAt`: 2026-09-03T04:06:46.877Z  
Hashes: report `98ccb7b13f2bdfb275cfc6e5682e5b8d44d0a9629e2c874c9549d19552651b16`, gate-decision `e124b1220855027dfd2e0b56ca91241f16c1d3fb58081dc1ce95d5e22fbf48d1`  
Log last line: `[w2-live] ov-19 overflow seed=2 (300/300)` then `EXIT:0`.

This is the current-HEAD Provider 100×3. It is **not** `a6281b3` and **not** `artifacts/runs/w2-live-native/gate`. Cut policy is still W2 same-cut (`keepRecent=2048`), not the W5 20000 natural lane.

| Gate field | Value |
| --- | --- |
| pairs attempted / in report.json | 300 / 300 |
| `sample.completedPairs` | **280 / 300** (20 `armFailures`, all `prompt did not settle in 180000ms`) |
| `sample.sameCutPairs` | 280 (sameCutRate=1 on the scored set) |
| B0 native / B1 fromHook / B2 fromHook / F0 ceiling | all true |
| B1==B2 compact summary text | **300 / 300 identical** |
| B0 ok / B1 ok / B2 ok / F0 ok | 288 / 298 / 298 / 296 |
| `hard.directiveCoverage` | 0 (B1 dir=1 is 288/300, not all) |
| exact recovery | `n/a` or failed; denominator 0; `recovered=false` |
| `nativeMustOmitLeak` | 55 (B0 tool-heavy); B1/B2 leak 0 |
| `hardGatePass` | **false** |
| quality CI (B1−B0) | estimate/lower/upper all 0 |
| `tokenMedianRelativeDelta` | **+10.97** (B1 probe much larger than B0) |
| `realizedNetMedian` | **−7314** |
| `costPerSuccessRelativeDelta` | +14.34 |
| overflow recovery B0 vs B1 | 0.933 vs 0.950 |
| decision | **`keep-pi-native`** |
| `publicationClaim` | **false** |
| gate reason includes | `sample below W2 publication floor (100 pairs × 3 seeds)` because scored 280/300 |

Checkpoint: Native B0 summary median **398.5** tokens; B1/B2 summary median **24** tokens (22–26). Compact hook is shared.

Probe input (identity vs PCR):

| Family | n | B0 probe median | B1 identity probe median | B2 PCR probe median | B0 summary med | B1/B2 summary med |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| tool-heavy | 60 | 666 | 7997 | 516 | 486.5 | 24 |
| constraint | 60 | 489 | 7990 | 515 | 421 | 22 |
| temporal-update | 60 | 91 | 592 | 513.5 | 338.5 | 26 |
| branch | 60 | 480.5 | 7993 | 514 | 370 | 24 |
| overflow | 60 | 504 | 7993.5 | 514 | 382.5 | 22 |

B1 identity probe is still bimodal (often ~7990). B2 PCR stays ~76–662 (median 514). Same compact text, different materialize.

20 arm timeouts (infraExcluded): B0 12, B1 2, B2 2, F0 4. Scored gate therefore **is not** a clean 300/300 publication sample.

## 6. Findings that stay open

| ID | Status | This campaign |
| --- | --- | --- |
| NF014 | live-open | Natural `triggered=false`. Overflow not observed. Recursive ≥3 **was** observed as hand-compact, which does not close the natural/overflow half |
| NF012 | live-open | Current-HEAD 100×3 bundle now exists under `paired-gate/`, but Hard FAIL, scored 280/300, `publicationClaim=false`. Do not treat the bundle as a passing gate |
| NF013 | live-open | B1/B2 compact summaries still 300/300 identical. Probe sizes differ (identity noisy ~8k, PCR ~514). Exact recovery denominator 0 |
| NF021 | blocked-host | Corpus still synthetic replay, not desensitized real traces |
| publicationClaim | false | Hard fail; 280/300 scored; sample-below-floor reason on gate-decision |

## 7. Native vs PCR (this HEAD only)

1. **Growth to the advertised window.** Native can reach ~187–191k billed (`input+cacheRead`). PCR Host View / context hook collapses billed to ~9.5k around 150–158k **without** a compaction JSONL row. PCR therefore does not exercise Pi’s 183808 threshold on this provider.
2. **Natural compact.** Only Native tool-heavy produced a compaction row (`tokensBefore=187164`, native hook, `reason=null`). Native large-turn hung at 190k. PCR produced none.
3. **Overflow.** Neither arm got a real `context_length` error. Native went to 191k then zero-usage replies. PCR never stayed large enough to overflow.
4. **Recursive hand compact.** PCR can emit 3 compaction rows if the harness grows between them. One of the three was native fallback.
5. **Same-cut W2 compact.** B0 native summaries are ~350–490 tokens. B1/B2 PCR-hook checkpoints are ~24 tokens and **byte-identical** across identity vs pcr. Materializer mode changes probe size, not the checkpoint.
6. **Adopt PCR?** No. 100×3 Hard FAIL, B1 probe is larger not smaller, natural/overflow lanes not observed.

## 8. What was not run

- A **passing** 300/300 100×3 with `hardGatePass=true` (this HEAD attempted 300, scored 280)
- Filling `real-traces`
- npm publish / W6 enable / `findCutPoint` / lowering keepRecent for W5
- Closing ledger rows
