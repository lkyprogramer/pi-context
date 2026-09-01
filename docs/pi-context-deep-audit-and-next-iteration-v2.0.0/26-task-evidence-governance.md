# AI Task Evidence 与状态治理

## 状态机

```text
pending → claimed → red-proven → implemented → narrow-green
→ full-gate-green → review-passed → done
                     ↘ blocked/inconclusive/reopened
```

## Done 校验

Controller 必须机器验证：

- Task ID、Owner、Dependencies；
- 当前 HEAD 与 clean tree；
- Allowed Diff；
- RED command/exit/log hash；
- GREEN/FULL-GATE command/exit/log hash；
- Acceptance Assertions；
- Run Bundle Hashes；
- Finding closure evidence；
- Evidence Schema；
- Commit ancestry；
- Artifact manifest。

任何一项缺失，状态只能是 blocked/inconclusive，不得 done。

## Evidence 反欺骗

- 同一个通用 full-gate log 不能自动完成多个语义不同任务；
- 测试名称不能作为 acceptance；必须解析结果字段；
- `runBundleHashes: []` 对 Live/Release 任务非法；
- open P0 对应任务不可关闭；
- 后续真实 Run 反驳旧 Evidence 时自动 reopen。
