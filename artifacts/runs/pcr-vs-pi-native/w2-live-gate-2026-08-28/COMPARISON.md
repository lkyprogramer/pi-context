# Live Pi Native vs PCR Compactor Comparison

## Run Identity

- Run ID: `w2-live-native-gate`
- Generated: `2026-08-28T15:18:20.407Z`
- Gate: W2 compactor head-to-head (`docs/pi-context-compression-benchmark-spec/17-w2-compactor-head-to-head-gate.md`)
- Protocol: `30-pi-native-vs-pcr-comparison-protocol.md`, `19-pi-benchmark-harness.md`
- Pi: `@earendil-works/pi-coding-agent@0.84.3`
- Model: `openclaw/Qwen3.8-27B-WORK`
- `contextWindow`: **200192** (unmodified)
- `maxTokens`: **16384** (unmodified; not the isolated 256 used by `live:compact`)
- Compact path: Pi RPC `session.compact()` = **manual** (spec-valid; threshold was not used because filling ~198k tokens is not required when the same cut is frozen)
- Cut policy (shared): `keepRecentTokens=2048`, `reserveTokens=16384` → Native summarizer `maxTokens=min(0.8*reserve, model.maxTokens)=13107`
- B0: `--no-extensions` live Native compact (`fromHook=false`)
- B1: `pi -e apps/pi-context-runtime/dist/extension.js --no-extensions` (`fromHook=true`)
- Report hash: `5dad9974093f137873988984bbabd71e78f42ed19d2f8185d396eb61fce9b8d8`

## Sample Integrity

- Expected pairs (W2 gate floor): 100
- Completed pairs: **100/100**
- Arm failures: 0
- Infrastructure exclusions: 0
- Same cut / same `firstKeptEntryId` / same `tokensBefore`: **100/100**
- Efficiency-eligible pairs (no Native overshoot): 100
- Replicates: **1** (spec W2 closed-loop asks for 3 executor seeds; not run)
- B2 / semantic recall: not in this run (compactor-isolated B0 vs B1)
- `publicationClaim`: **false**

## Method (what this is and is not)

This is **compactor-isolated live pairing**, not the old synthetic B0 and not the isolated `maxTokens=256` overflow smoke.

1. Freeze the same W1-shaped session JSONL (directive + tool dump + retained tail).
2. Clone the full JSONL tree into independent Pi homes.
3. Trigger **live** `compact()` on each clone with identical compaction settings.
4. Run the same hidden closed-loop probe after compact.
5. Score hard / reader / closed-loop / efficiency with `evaluateW2Gate` (margin 0.02, bootstrap 10000).

It is **not** a publication claim that PCR beats Native. Hard gate failed. Seeds were not triplicated.

## Integrity and Security

| Check | B0 Native | B1 PCR | Gate uses |
|---|---:|---:|---|
| `fromHook` | 0/100 | 100/100 | both required |
| Hard directive coverage | 78/100 | **80/100** | B1 must be 1.00 |
| Must-omit leak | **19/100** (all tool-heavy) | **0/100** | B1 must be 0 |
| Unsupported high-risk outcome | 0 | 0 | B1 |
| Tool-pair violation | 0 | 0 | B1 |
| Secret absent after compact | 81/100 | 100/100 | B1 recovered=1.00 here means “secret not in visible”, not blob `readEvidenceById` |

Hard gate **fail** because B1 directive coverage is not 1.00: all 20 `temporal-update` checkpoints only kept the capture span `改为` / `instead`, not `version=7-*`.

## Quality

Closed-loop success: **B0 71/100**, **B1 80/100**.

Paired bootstrap median differences are 0 on quality/polarity/time/update/abstention/closed-loop (most pairs both succeed or both fail). CI lower = 0 ≥ −0.02, so **non-inferiority would pass** if hard gate passed.

Constraint violations: B0 0, B1 0.

By family (closed-loop / quality mean / probe input mean):

| Family | B0 loop | B1 loop | B0 quality | B1 quality | B0 probe in | B1 probe in |
|---|---:|---:|---:|---:|---:|---:|
| tool-heavy | 12/20 | 20/20 | 0.90 | 1.00 | 820 | 504 |
| constraint | 20/20 | 20/20 | 1.00 | 1.00 | 580 | 370 |
| temporal-update | 0/20 | 0/20 | 0.34 | 0.25 | 533 | 404 |
| branch | 19/20 | 20/20 | 0.99 | 1.00 | 480 | 315 |
| overflow | 20/20 | 20/20 | 1.00 | 1.00 | 459 | 298 |

Native leaked `sk-live-w2-omit-*` in 19/20 tool-heavy summaries. PCR did not. Native still often honored “do not change public API” after leak; PCR honored all 20.

Both arms **failed temporal-update closed-loop**: Native often answered stale `3` or emitted a fake tool call; PCR asked for the version or echoed `cr_runtime` because claims/pointers are empty.

## Efficiency

- Artifact summary tokens median: Native **405** vs PCR **135**
- Next-turn probe input median: Native **511** vs PCR **306**
- Token median relative delta (B1 vs B0 probe input): **−36.7%** (beats −15%)
- Cost/success relative delta: **−44.6%** (beats −10%)
- Realized net median: **+194.5 tokens** (positive)
- Overflow recovery: both 20/20; not a Native-beating overflow win
- Native summary never exceeded 13107×1.05 → `budgetMismatchRate=0`
- Compact latency p50: Native **8677ms** vs PCR **1139ms** (PCR is deterministic; Native pays for generateSummary)

Efficiency **would pass** the W2 token or cost clause. Hard gate still blocks `proceed-to-semantic`.

## Gate Decision

- Decision: **`keep-pi-native`**
- Hard gate pass: **false**
- Publication claim: **false**
- Reasons: temporal-update directive coverage is not 1.00 on PCR; W2 does not adopt the compactor from a failed hard gate even when tokens look better.

Counterfactual: if temporal coverage were 1.00, this sample’s reader/closed-loop CI and efficiency would satisfy `proceed-to-semantic`. That is **not** the recorded decision.

## Failure Attribution

- Compressor: PCR drops correction payloads (`改为` without `version=7`); Native leaks secrets on tool-heavy dumps and also drops latest version.
- Retriever: not exercised (no proactive recall / B2).
- Reader: closed-loop probe is the executor, not a separate reader model.
- Executor: `--no-tools` still saw some models emit raw `<tool_call>` text on temporal probes.
- Infrastructure: none; 100/100 pairs completed.

## Limits (do not over-read)

- Manual compact on a frozen cut, not live 200k threshold overflow.
- `keepRecentTokens=2048` is a shared cut policy, not Pi’s default 20000. Native **generation** budget was still the real 16384/13107 band.
- Replicates=1, not 3.
- PCR live checkpoint still has empty claims/pointers; “exact recovery” is not W1 blob readback.
- Single provider/model. Not vs billion-context.
- Spec-smoke (30 pairs) was run first; numbers above are the 100-pair gate.

Re-run:

```bash
nvm use v22.19.0
PCR_W2_LIVE_PROFILE=gate pnpm live:w2-paired
```
