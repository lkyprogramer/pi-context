# 本包校验

```bash
cd docs/pi-context-6.1-round8-verdict-and-regimes
python3 scripts/validate_bundle.py
shasum -a 256 -c MANIFEST.sha256 --quiet && echo manifest-ok
```

`validate_bundle.py` 期望输出 `errors: []`。它校验：

- 全部文件非空；JSON 可解析；Markdown 代码围栏成对；相对链接可达。
- `tasks/index.json` 7 个唯一 id、DAG 无环、每张任务卡含全部规定小节（文件范围 / 接口合同 / 非目标 / TDD 第一条红测 / 最小实施顺序 / 负例与边界 / 完成验证 / 验收 / Review focus）与 `ts`、`bash` 代码块；`narrow` 以 `pnpm exec vitest run` 开头；`files` 中每个路径在卡内出现。
- `audit/findings.json` 12 项，归因与严重度合法，每项至少映射一个任务，任务 `closes` 与 finding `tasks` 双向一致。
- `testing/scenarios.json` 8 Q + 2 C + 4 W + 1 X，按 lane 的 arms×reps 推算得 84 episode；主目标 `fresh-input`；Q05/W-Q05/X01 标 exactQuote。
- `evidence/run-aggregates.json` 三次 run 全部 `dirty=true`、`review-needed`、balanced 16 fold / 0 native compaction、unknown usage 0。
- `MANIFEST.sha256` 覆盖除自身外全部文件且哈希一致。

## 证据等级

| 内容 | 等级 |
|---|---|
| 代码行号、函数名、测试名 | 已读源码（基线 `0e7fb400`） |
| 三次 run 的聚合数字 | 已用 `aggregate_runs.py` 从 `artifacts/` 实算，可复算 |
| "三次 run 均 dirty" | 已读 `manifest.json.git.dirty` |
| `pnpm check` 通过 | 已运行（exit 0，200 tests） |
| W lane 触发时机、X01 native compaction 次数、日志 token 估算 | 推断，待 S06 受控校准与 S07 首个 episode 验证 |
| 任务卡中的 RED 测试可在当前基线失败 | 按已读代码推断，未实际运行（本包为规划文档，不改目标仓库） |
| 任何 balanced 的质量/成本结论 | 未验证；三次 dirty run 只作诊断 |

## 与目标仓库的关系

本包只新增 `docs/pi-context-6.1-round8-verdict-and-regimes/`，不修改 `src/`、`eval/`、`test/` 或其他文档。任务卡中的代码是要在目标仓库实现的规范。
