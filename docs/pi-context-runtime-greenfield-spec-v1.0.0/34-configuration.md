# 配置模型与 Profile

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义唯一配置 Schema、五套 Profile、跨字段不变量和 runtime capability requirements。

## 2. 已冻结决策

- 配置从 global → workspace → session override 合并。
- 未知 key reject。
- 配置 fingerprint 进入 candidate/view identity。
- 安全/容量不变量不能被低层 profile 关闭。
- 比例是初始值，绝对 token 对小窗口优先。

## 3. Profiles

- `deterministic-minimal`：exact-only，semantic off，FTS optional；
- `balanced`：默认，reducers/FTS/directive/claim/continuity/background deterministic；
- `quality-first`：semantic proposal + verifier + larger recall；
- `cost-first`：strict background budget、lower view retention；
- `security-strict`：trusted RPC required、fail closed、egress/action approval。

## 4. Cross-field Invariants

```text
0 < targetRatio < softRatio < hardRatio < 1
activeTurnMinTokens + directiveMaxTokens < effectiveInputBudget
hostCompactAfterMessages > recentTailMinMessages
viewRetentionDays <= rawEvidenceRetentionDays
semantic.enabled implies verifier.enabled
securityStrict implies observationFailurePolicy=fail-closed
```

## 5. Runtime Checks

FTS availability、Node version、Pi capabilities、key permissions、known conflicts、DB schema、disk free space 在 ready 前检查。配置改变使 background candidates stale。

## 6. 不变量

1. Profile 不能把 active directive 或 action gate 关闭。
2. Secret values 不可通过环境插值后写入 resolved config log。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `configs/`
- `schemas/runtime-config.schema.json`
