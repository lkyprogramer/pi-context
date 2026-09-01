# 上一版计划 A00–A50 完成度复核

## 结论

`.task-state.json` 将 A00–A49 全部标为 `done`，但本次按各任务自身的“目标/验收/负例”复核后，存在大量 partial 与 not-met。根因不是单纯漏跑测试，而是 Controller 的完成协议过弱：

```python
# 旧 taskctl.py
if not evidence.exists(): raise SystemExit('missing-evidence')
state[task] = {'status':'done'}
```

它不读取 Evidence 内容，也不验证：

- RED 是否曾失败；
- GREEN/FULL-GATE exit code；
- Commit 是否为当前 HEAD 祖先；
- allowed files；
- sourceDigest；
- runBundleHashes；
- Finding 是否真正关闭；
- Task 自身 Acceptance Assertions。

## 直接矛盾

| 任务 | 文档验收 | 当前真实结果 | 结论 |
|---|---|---|---|
| A34 | 真 Pi B0/B1/B2，B2 非字符串模拟 | Legacy 仅 B0/B1；V3 B2 为字符串 | not-met |
| A37 | 模型自己选工具，环境断言 | Component Executor/弱 Probe | not-met |
| A43 | 每 arm 至少一次真实 threshold | Native/PCR 都 0 compact | not-met |
| A44 | 真实 overflow→compact→retry | overflowObserved=false | not-met |
| A45 | 三次 compact+branch+restart | compactCount=1 | not-met |
| A48 | W1/W2 Deterministic Release Gate | liveProvider=false，旧 commit | not-met |

## Evidence Seal 问题

抽样 A05/A08/A12/A14/A21/A30/A34/A35/A37/A42–A49：

- `runBundleHashes` 全为空；
- 多个 Wave 内所有 Task 共享同一 Commit 和同一 Full Gate；
- Evidence 中 `findingsClosed` 与 `findings.json` 全部 open 矛盾；
- A43/A44/A45 的 Evidence 在真实 Lane 执行前已封存为 done。

## 修复

采用 `schemas/task-evidence-v2.schema.json` 与 B03/B04：Done 是可验证状态迁移，不是人工标签。完整逐任务矩阵见：

- `compliance/previous-task-status.csv`
- `compliance/previous-task-status.json`
