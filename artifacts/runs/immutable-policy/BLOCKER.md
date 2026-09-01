# B07 blocker

`.gitignore` still drops `artifacts/runs/w2-live-native/`, `live-compact/`, and `live-verification/`. That path is outside B07 allowed files (`packages/benchmark/src/report/**`, `scripts/benchmark/**`, `artifacts/runs/**`).

Live publication runs must call `writeImmutableBundle` with `rawArtifacts` so `verifyRawRunBundle` fails closed on preview-only JSONL. Changing gitignore / live runners is a later explicit task (B27/B28). NF012 and NF030 stay open.
