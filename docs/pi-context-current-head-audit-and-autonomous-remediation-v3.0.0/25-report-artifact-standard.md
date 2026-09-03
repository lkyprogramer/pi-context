# Report 与 Artifact 标准

报告标题必须包含：Commit、Run Epoch、Model、Provider、Corpus、Scorer、Planned/Completed。

每个数字必须能追溯到 pair row；每个 row 能追溯到 arm raw artifact；每个 artifact 有 bytes SHA-256；JSON 另有 canonical SHA-256。

禁止使用以下模糊词而不附限定：`complete`、`seed`、`billed`、`exact recovery`、`closed-loop`、`natural threshold`、`overflow recovery`、`recursive`。
