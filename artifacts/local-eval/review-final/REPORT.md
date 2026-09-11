# local-eval review-r8-20260911b

HEAD 878e92f292a7a0d50252d0fa49d89b91c696ca0f (dirty=false) · pi 0.85.1 · dist b414ff09808f (entry 34dfcba7da19) · model openclaw/Qwen3.8-27B-WORK · thinking medium · baseUrl http://47.106.205.246:1082/v1 · /metrics available

## decision

decision: limited-balanced-trial
reason: small canary only; no default change and no noninferiority claim
discordant:
- Q02/r1 candidate-fail-native-pass
- Q02/r2 candidate-pass-native-fail
counts: b=1 c=1 shared=0
attemptRates: first=1.000 final=1.000
objective.primary: fresh-input relativeChange=-0.645 known=true

candidates: fold-time-model-hint [Q02/r1] below-gate; inline-ref-marker [W-Q05/balanced/r1] below-gate; cold-aligned-fold [Q fresh-input -0.6450772917187859, W fresh-input -0.01705440256506141] met

Personal explicit trial only. Default profile stays **observe**. No non-inferiority claim. This package does not authorize a default change.

## objective

| metric | role | known | nativeSum | candidateSum | relativeChange |
|---|---|---|---:|---:|---:|
| fresh-input | primary | true | 1203169 | 427032 | -0.645 |
| logical-input | secondary | true | 7733756 | 2947728 | -0.619 |
| wall-time | secondary | true | 1457615 | 892115 | -0.388 |
| cacheRead | secondary | true | 6530587 | 2520696 | -0.614 |
| engine-prefill | secondary | true | 1246553 | 447729 | -0.641 |
| native-compactions | secondary | true | 5 | 0 | -1.000 |
| requests | secondary | true | 179 | 182 | 0.017 |

## regimes

| lane | pairs | b | c | shared | fresh-input | nativeCompactions n/c |
|---|---:|---:|---:|---:|---:|---:|
| warm | 12 | 0 | 3 | 3 | -0.017 | 12/2 |
| long | 3 | 0 | 1 | 0 | 0.195 | 4/1 |

Small samples (3 reps per cell). Counts only; no percentages extrapolated.
