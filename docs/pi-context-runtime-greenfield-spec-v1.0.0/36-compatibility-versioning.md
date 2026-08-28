# Pi 持续兼容、版本与 CI

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

把“不维护 Fork”转化为薄 Adapter、版本锁、能力探测和自动兼容矩阵。

## 2. 已冻结决策

- 初始支持 `0.84.3`，commit `938109e7259068ff736dbba3bed14c81af25abbe`。
- 公开 peer range 按 Pi 官方建议使用 `*`；内部 compatibility lock 使用窄窗口。
- 每个 Pi Minor 扩窗必须有 Contract CI 与 packed E2E。
- 禁止私有 import、monkeypatch 和文件行号假设。

## 3. Compatibility Lock

```json
{
  "adapterApiVersion": 1,
  "tested": ["0.84.3"],
  "supportedRange": ">=0.84.3 <0.85.0",
  "baselineCommit": "938109e7259068ff736dbba3bed14c81af25abbe",
  "requiredHooks": [
    "context", "tool_result", "tool_call", "session_before_compact",
    "session_compact", "session_start", "session_tree", "agent_settled"
  ]
}
```

## 4. CI Matrix

- pinned minimum；
- current supported；
- latest published advisory lane；
- Node 22/24/26 fixed lines；
- Linux/macOS；
- TUI/RPC/print modes；
- packed npm install。

Latest lane 可失败但必须生成 compatibility report；扩大 supported range 前必须修复并转为 blocking。

## 5. Upgrade Workflow

自动 dependency PR → Contract tests → Adapter diff review → packed E2E → benchmark smoke → 更新 lock/report → release patch/minor。Kernel/storage 不随 Pi API 变动重写。

## 6. 不变量

1. Runtime probe 缺关键能力时 fail closed，不“猜测兼容”。
2. 支持声明必须指向 CI evidence。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `compat/pi.lock.json`
- `tasks/T44-pi-compatibility-ci.md`
