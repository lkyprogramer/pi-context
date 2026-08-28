# 运维、诊断与故障处理

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 doctor/status/recover/export/gc/reindex/key rotate、降级模式和用户可操作恢复。

## 2. 已冻结决策

- 默认本地优先，无远程控制平面。
- 所有破坏性命令支持 dry-run 和 confirmation token。
- Recovery 先验证，再修改。
- Not-ready 原因结构化输出。

## 3. Commands

```text
/pcr-status
/pcr-doctor
/pcr-context
/pcr-recall <id|query>
/pcr-compact
/pcr-recover
/pcr-export
/pcr-gc --dry-run
/pcr-reindex
/pcr-conflicts
```

## 4. Degraded Modes

- `exact-only`：FTS unavailable；
- `read-only-recovery`：DB integrity/migration issue；
- `host-pass-through`：Kernel unavailable但安全政策允许；
- `blocked`：key/owner/scope/security hard failure。

Balanced profile 的 raw capture、directive 和 action gate 失败不允许静默 pass-through。

## 5. Troubleshooting

每个 error code 给出：影响范围、自动恢复、用户动作、证据位置、是否可继续。禁止把 secret、raw args 或绝对 path 放进错误文本。

## 6. 不变量

1. Doctor 不执行副作用工具。
2. Export 默认加密并 scope 到当前 workspace/session。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `checklists/operations.md`
- `tasks/T47-operations-cli.md`
