# 后台 Candidate 与 Generation 状态机

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

把高成本语义处理移出前台，同时用完整 snapshot identity、取消和 CAS 防止 stale apply。

## 2. 已冻结决策

- 后台只 prepare，不直接改变 Pi context 或 committed head。
- candidate key 绑定 session/leaf/model/thinking/config/reducer/schema/source heads。
- 任何 branch/model/config/source change 使 candidate stale。
- hard/overflow path 永不等待后台。
- 记录 ready hit、stale、wasted token 和前台延迟收益。

## 3. State Machine

```text
idle → preparing → prepared → verifying → ready
                    ↘ failed/stale/cancelled
ready → publishing → committed
        ↘ stale/rejected
```

## 4. Candidate Key

```text
workspaceId + sessionId + lineageHash + sourceHead
+ modelKey + thinkingLevel + contextWindow
+ systemPromptHash + activeToolSetHash
+ reducerRevisionSet + extractorRevision
+ schemaVersion + configFingerprint
```

## 5. Scheduler

只在 `agent_settled` 或明确 idle boundary 启动；每 Workspace 默认 1 job；有 deadline、AbortSignal 和 token/cost budget。短会话、低增长、预计不会命中 ready 的 job 不启动。

## 6. 不变量

1. Candidate bytes 未通过 verifier 不可进入 committed state。
2. Stale candidate 不复用到另一个 branch/model。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `30-semantic-proposal-and-verifier.md`
- `tasks/T34-background-candidates.md`
