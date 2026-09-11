# 脚本

两个脚本都只读目标项目与 `artifacts/`，不写源码、不调用 Provider、不读取 Key。

```bash
# 在本包目录下执行
python3 scripts/validate_bundle.py
python3 scripts/aggregate_runs.py --artifacts ../../artifacts/local-eval \
  --runs review-qc-20260910 review-qc-20260911 review-qc-20260911-fold1 \
  --out evidence/run-aggregates.json
```

`validate_bundle.py`：结构、内链、任务 DAG、finding↔task 双向映射、场景计数与 84 episode 推算、证据 JSON 的关键不变量（三次 run 都是 dirty、都 `review-needed`、balanced 16 fold/0 compaction、unknown usage 0）、`MANIFEST.sha256` 覆盖与哈希。任一失败 exit 1。

`aggregate_runs.py`：从 run 目录的 `manifest.json / episodes.jsonl / requests.jsonl / report.json` 聚合 Q lane 的臂级计数、相对变化与不一致 pair，并比较相邻 run 的 `distFiles` 差异。它是 `audit/03-run-evidence.md` 数字的来源，任何人可以重跑核对。它不是 `eval/local/report.mjs` 的替代，也不参与裁决。

重生成 manifest：

```bash
find . -type f ! -name MANIFEST.sha256 ! -path '*/__pycache__/*' -print0 | sort -z | xargs -0 shasum -a 256 | sed 's#  \./#  #' > MANIFEST.sha256
python3 scripts/validate_bundle.py
```
