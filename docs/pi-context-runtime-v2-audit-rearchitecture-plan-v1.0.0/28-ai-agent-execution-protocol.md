# AI Agent 自主执行协议

## 基本规则

1. 一次只 claim 一个 Task；
2. 只能修改 Task 的 Allowed Files；
3. 必须先产生 RED evidence，再写实现；
4. Task 的 narrow GREEN 与 repository gate 都要保存完整日志；
5. 不允许编辑 generated report/decision；
6. 不允许修改 locked benchmark；
7. 需要跨任务接口变更时创建 blocker，不得隐式扩 scope；
8. 每个 Task 一个原子 commit；
9. Completion 由 `taskctl verify` 和 reviewer checklist 决定，不由 Agent 自述决定。

## 状态

```text
blocked → ready → claimed → red → green → verified → committed
```

## Evidence

每个 Task 目录：

```text
artifacts/task-evidence/Txx/
  preflight.json
  red.log
  green.log
  full-gate.log
  changed-files.json
  evidence.json
  commit.txt
```
