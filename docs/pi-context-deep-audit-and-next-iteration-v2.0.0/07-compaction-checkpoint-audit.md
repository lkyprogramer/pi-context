# Checkpoint 与 Compaction 审计

## 已完成的改进

- Checkpoint v2 支持 directives、claims、continuity、pointers、heads；
- Pointer Verifier 不再是完全空实现；
- short-ref 默认减少模型不可读 hash 开销；
- `6afd5de` 在 active directives 为空时从 messagesToSummarize 回填，并拒绝 empty-shell checkpoint；
- Native fallback 保持存在。

## 三个结构性问题

### 1. Snapshot 非原子

Compaction assembler 的 `transaction.run` 只是调用 `work()`，directives/continuity/claims/pointers 各自查询。若 Tool Result/Correction 同时到达，可能生成混合代际 Checkpoint。

### 2. Durable Ack 缺失

Stage/Ack/Failure 没有持久 Journal，也没有 Runtime Store generation commit。Host 已写 CompactionEntry 但 Runtime 未 Ack、或相反，都缺恢复规则。

### 3. Hard Gate 未进入产品/Live

`hard-gates.ts` 的 tool pair、tail、two-run hash 只在组件测试。Legacy Live Report 仍写：

```json
"toolPairViolation": 0
```

这不是观测值。

## 当前 13-token 与 117/145-token 两类 Checkpoint

修复前 100×3 的 13-token Artifact 得到巨大效率，但 directive coverage=0；修复后 smoke 恢复 directive/recovery。两次结果来自不同代码状态，不得合并为“同时快且保真”。必须在同一最终 HEAD 重跑完整 100×3。
