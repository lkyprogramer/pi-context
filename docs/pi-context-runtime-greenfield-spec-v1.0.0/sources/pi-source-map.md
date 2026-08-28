# Pi Source Map（固定快照）

- Repository: `earendil-works/pi`
- Commit: `938109e7259068ff736dbba3bed14c81af25abbe`
- Coding Agent package: `0.84.3`

| 关注点 | 路径 |
|---|---|
| Extension types/events | `packages/coding-agent/src/core/extensions/types.ts` |
| Extension runner semantics | `packages/coding-agent/src/core/extensions/runner.ts` |
| Agent transformContext boundary | `packages/agent/src/agent-loop.ts` |
| Coding-agent SDK wiring | `packages/coding-agent/src/core/sdk.ts` |
| Tool result adapter | `packages/coding-agent/src/core/agent-session.ts` |
| Session entry/tree | `packages/coding-agent/src/core/session-manager.ts` |
| Message conversion | `packages/coding-agent/src/core/messages.ts` |
| Compaction docs | `packages/coding-agent/docs/compaction.md` |
| Extension docs | `packages/coding-agent/docs/extensions.md` |
| Package docs | `packages/coding-agent/docs/packages.md` |
| Session format | `packages/coding-agent/docs/session-format.md` |

事实基线：`context` 可修改每次请求 messages；`tool_result` 可修改持久化前结果；Compaction Hook 可返回自定义结果；Pi Session 是 JSONL Tree；CustomEntry 不进入模型上下文。
