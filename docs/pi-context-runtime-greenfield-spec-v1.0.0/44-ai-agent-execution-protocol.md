# AI Agent 自主开发执行协议

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

规定 AI 执行每个 Task 的输入、文件边界、TDD、证据、状态、阻断和交接，使任务可独立自动运行。

## 2. 已冻结决策

- 每次只执行一个 Task。
- 只读取 Task 指定的 Spec/ADR/Interfaces 和必要源码。
- 不得猜测未定义接口；发现冲突写 Blocker Report。
- 每个任务必须有 RED、GREEN、full gate 和 acceptance evidence。
- 任务完成不等于 Wave/Release 完成。

## 3. 执行输入

AI 收到：Task 文件、当前 repo、`.pcr/task-status.jsonl`、依赖任务 evidence、对应 specs/ADRs。不得依赖本 ZIP 外部 Skill 或私有记忆。

## 4. 每任务状态机

```text
pending → in-progress → review → done
                  ↘ blocked
```

Claim `done` 前必须生成：

```text
artifacts/task-evidence/Txx/
  preflight.json
  red.log
  green.log
  full-gate.log
  acceptance.json
  diff.patch
  handoff.md
```

## 5. 文件边界

Task 中列出的 Create/Modify/Test 是允许范围。确需修改相邻公共契约时：停止、创建 `blockers/Txx-contract-change.md`，说明原因、最小变更、影响任务和建议 ADR；不能顺手改。

## 6. Verification

每条 completion claim 必须基于本次 fresh command output；读完整输出、确认 exit code、失败数和 skipped。Agent 报告成功不能替代独立验证。

## 7. Handoff

`handoff.md` 必须写：实现摘要、公共接口、测试数量、已知限制、下一任务需要的信息、commit SHA。禁止写模糊“应该”“大概”。

## 8. 不变量

1. 无 red.log 的任务不能 done。
2. Acceptance 中每项必须 true 且有 evidence path。

## 9. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 10. 关联资料

- `tasks/EXECUTION-PROTOCOL.md`
- `schemas/task-status.schema.json`
