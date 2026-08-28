# Pi Compaction 接管与 Host Checkpoint

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

使用 Pi 正式 Compaction Hook 周期性收敛宿主 active history，并以外部 heads 保持可恢复性。

## 2. 已冻结决策

- PCR 不永久取消 Pi Compaction，而是作为唯一 custom Compaction provider。
- Checkpoint deterministic path 始终可用。
- Overflow 不等待 semantic candidate。
- `session_compact` 是 generation commit acknowledgment。
- Pi summary 只是 Host View，不是 PCR canonical memory。

## 3. `session_before_compact`

```ts
pi.on("session_before_compact", async (event, ctx) => {
  try {
    const candidate = await runtime.prepareHostCheckpoint({
      cursor: adapter.cursorFromBranch(event.branchEntries, ctx),
      preparation: adapter.toHostCompactionPreparation(event.preparation),
      reason: event.reason,
      willRetry: event.willRetry,
    }, event.signal);
    return { compaction: adapter.toPiCompactionResult(candidate) };
  } catch (error) {
    return adapter.recoverCompaction(error, event, ctx);
  }
});
```

## 4. Checkpoint 内容

- active directives；
- stable continuity snapshot；
- unresolved errors/side effects；
- bounded directory/pointers；
- generation/head hashes；
- 明确说明 raw history 可通过 PCR tools 查询。

`details` 包含 schemaVersion、generationId、directiveHead、claimHead、continuityHead、catalogHead、outputHash、reducer revisions。不得包含 raw secret 或绝对路径。

## 5. Commit

`session_compact` 使用 CompactionEntry ID、details 和当前 leaf 对应 prepared generation，幂等提交。`session_compact_failed` 将 candidate 标 stale/failed；manual cancel 不提交。

## 6. Periodic Trigger

在 `agent_settled` 评估 host active message count、host token estimate、context clone latency、next overflow horizon。达到 host convergence threshold 时调用 `ctx.compact()`；只在 idle、无 pending messages、无 active side-effect transaction 时执行。

## 7. 不变量

1. Host checkpoint 必须严格 shrink Pi active context。
2. Compaction 不能删除 PCR raw evidence/directive。

## 8. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 9. 关联资料

- `tasks/T30-deterministic-host-checkpoint.md`
- `tasks/T31-compaction-takeover.md`
