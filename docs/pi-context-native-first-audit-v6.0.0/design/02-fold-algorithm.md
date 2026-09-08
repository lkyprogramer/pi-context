# 折叠算法与本地栈成本模型

## 1. 数据流（balanced，每次 `context` 事件）

```text
context(event.messages, ctx)
  ├─ usage = ctx.getContextUsage()            // {tokens, contextWindow, percent}; tokens 可能为 null（压缩后首请求）
  ├─ entries = branchEntries(ctx.sessionManager) // 从 leaf 沿 parentId 到根，正序
  ├─ mapping = mapToolResults(messages, entries) // toolCallId 唯一匹配；重复/缺失 → 不映射
  ├─ if plan && planStillValid(plan, entries, modelId, configHash): goto render
  ├─ if shouldFold(usage, plan, cfg):
  │     batches = collectBatches(entries); exposed = exposedEntryIds(entries)
  │     plan = planFold({...})                 // 可能返回 previous 或 null
  │     if plan 新增条目: emit FoldEvent; telemetry
  └─ render: renderFold(messages, plan, mapping) → return { messages }
```

`planStillValid`：`plan.sessionId == 当前 sessionId`、`plan.compactionBoundary == 当前分支最新 compaction id`、`plan.modelId == ctx.model.id`、`plan.configHash == 当前 configHash`。任何一项不等 → `plan=null`。事件 `session_compact`、`session_tree`、`model_select`、`session_start` 直接置 null 作为快路径。

## 2. 派生暴露（替代 ledger）

```ts
export function exposedEntryIds(entries) {
  const exposed = new Set<string>();
  const pending: string[] = [];
  for (const e of entries) {
    if (e.type === "message" && e.message.role === "toolResult") pending.push(e.id);
    else if (e.type === "message" && e.message.role === "assistant") {
      const ok = e.message.stopReason !== "error" && e.message.stopReason !== "aborted"
        && ((e.message.usage?.totalTokens ?? 0) > 0 || (e.message.usage?.input ?? 0) > 0);
      if (ok) { for (const id of pending) exposed.add(id); pending.length = 0; }
    }
  }
  return exposed;   // pending 里剩下的是最后一批尚未被任何成功响应消费的结果
}
```

Pi 只有在 provider 成功返回后才持久化带 usage 的 assistant entry；错误响应 `stopReason="error"`、用户中止 `"aborted"`。因此"其后存在成功 assistant"等价于"该 toolResult 进入过一次成功请求的输入"。不需要跟踪 request id，也不需要在 `message_end` 里 ACK。

边界：`compaction` entry 之后的 assistant 也算成功响应，但被压缩掉的 toolResult 已不在 `buildContextEntries` 结果里，所以不会出现在 `entries`。

## 3. 批次与保护集

```ts
collectBatches(entries):
  for each assistant entry with toolCall blocks:
    calls = blocks.filter(type==="toolCall").map({id,name})
    results = toolResult entries whose toolCallId ∈ calls (按出现顺序)
    complete = calls.every(c => results.filter(r => r.callId===c.id).length === 1)
    hasNonText = results.some(r => r.content.some(b => b.type !== "text"))
protect(batches, K):
  最后 K 个 complete 批次 ∪ 所有 !complete 批次 ∪ hasNonText 批次 ∪ 含 isError 结果的批次
```

`isError` 只取 toolResult 消息的 `isError` 字段（Pi 官方字段），不看 assistant 的 stopReason，不做正则猜测。错误结果永不折叠——文献（Complexity Trap 的 trajectory elongation）和 6.0.0 F12 都指向这一点。

## 4. 计划

```ts
planFold(input):
  if (!usage.percent || usage.percent < cfg.fold.triggerPercent) return previous;
  candidates = entries.filter(e => role==="toolResult"
      && exposed.has(e.id) && !protected.has(e.id)
      && every text block bytes ≥ minFoldableBytes
      && !(previous?.replacements has `${e.id}:${i}`))
    .sort(byBranchOrder)                       // 最旧优先
  target = usage.contextWindow * cfg.fold.targetPercent / 100
  est = usage.tokens; saved = 0; next = new Map(previous?.replacements)
  for (e of candidates):
    if (est <= target) break
    for (i of textBlocks(e)):
      ref = refForField(scope, e, i); if (ref is error) continue
      stub = stubFor({...})
      s = estimateTokens(text) - estimateTokens(stub); if (s <= 0) continue
      next.set(`${e.id}:${i}`, {..., savedTokensEstimate: s}); est -= s; saved += s
  if (saved < cfg.fold.minRemovedTokens) return previous;   // 不值得打断缓存
  return { planId, sessionId, compactionBoundary, modelId, configHash, createdAt, usagePercentAtPlan: usage.percent, replacements: next };
```

估算用 Pi 同款 `chars/4`；真实效果由下一条 assistant 的 `usage.input` 验证并写入遥测。参数默认 `trigger=60 / target=40 / K=4 / minRemoved=4096 / minFoldable=1024` 是工程初值，E03 后可调，但**不能在看到某个 case 结果后为通过而调**。

`triggerPercent` 上限 85：Pi 默认 `reserveTokens=16384`，在 262144 窗口上原生阈值是 93.75%；折叠必须留出至少一个大工具批次（~8%）的余量，否则 Pi 会先压缩，plan 白建。若用户改了 Pi 的 `compaction.reserveTokens`，需自行下调 trigger；插件无法读取 Pi settings，status 里提示假设值。

## 5. 渲染

```ts
renderFold(messages, plan, mapping):
  applied = 0; first = null
  messages.forEach((m, idx) => {
    const id = mapping.get(idx)?.entryId; if (!id || m.role !== "toolResult") return;
    if (!Array.isArray(m.content)) return;
    m.content.forEach((b, i) => {
      const r = plan.replacements.get(`${id}:${i}`); if (!r || b.type !== "text") return;
      if (sha256(b.text) !== r.sourceHash) return;     // 其他扩展改过 → 不折叠该块
      b.text = r.stub; applied++; first ??= idx;
    });
  });
  return { messages, applied, firstChangedIndex: first };
```

同一 plan 每次请求产生逐字节相同的 stub，前缀在折叠点之后重新稳定。

## 6. 本地 4090 栈的成本模型（估算，E03 实测校正）

实测输入（[07](../audit/07-local-stack.md)）：prefill ≈ 1974 tok/s@184k（更短上下文更快，取 2000 保守）、append 请求 TTFT ≈ 3.3s@100k、Pi Java 三题 prefix 命中 ≈ 85%、decode 110→87 tok/s（120k→184k）。

| 事件 | 代价 | 说明 |
|---|---|---|
| 普通追加请求 | prefill ≈ 新增 token；命中 85% | Pi 默认行为，插件 observe 不改变 |
| 折叠一次（60%×262k≈157k，首个改写点≈10k，折掉≈60k） | 重新 prefill ≈ 157k−10k−60k ≈ 87k → ≈ 45 s，一次 | 之后回到 append-only |
| 原生 compaction（93.75%≈245k） | 摘要请求是**不同前缀**（摘要 system prompt）→ 冷 prefill ≈ 245k ≈ 120 s；摘要 decode 2–4k tok ≈ 25–40 s；压缩后新上下文冷 prefill ≈ 20k ≈ 10 s | 合计 ≈ 155–170 s，且摘要有损 |
| 折叠推迟的量 | 折掉 60k ⇒ 触及原生阈值前还能再增长 ≈ 60k token 的历史 | 一次折叠换约 60k token 的"免摘要"寿命 |

结论：在这个栈上，一次折叠约 45 s 换取推迟一次 ≈ 160 s 的有损摘要，并保留逐字回读；短会话（< 157k）永不触发，等价于 observe。这是设计假设，E03 用 `engine.prefillTokensDelta`、`usage.cacheRead` 曲线和墙钟实测。若实测折叠代价 > 推迟收益（例如模型频繁需要回读折叠内容），停在 observe。

### 6.1 为什么不是"逐请求 Expected Net Benefit 自适应投影"

外部反馈（[08](../audit/08-feedback-reconciliation.md) §7）建议把折叠决策改成 `token saving + provider pricing + cacheRead discount + firstChangedMessageIndex + expected future turns + recall cost + compaction proximity → net benefit > threshold`。这个公式在按 token 计费、cache 有折扣价的 API 栈上成立；在本地栈上它退化为下面三点，而 6.1 已经全部内化：

| 公式项 | 本地 4090 的取值 | 6.1 的对应物 |
|---|---|---|
| provider pricing / cacheRead discount | 单价为 0；真实成本只有 prefill 秒数与 KV 长度导致的 decode 变慢 | `invalidatedTokensEstimate / 2000 tok/s` 即为折叠代价 |
| firstChangedMessageIndex | 改写点之后全部作废 | plan 按从旧到新折叠，`firstChangedIndex` 记入 FoldEvent，报告用它算 `removed/invalidated` |
| expected future turns × per-turn saving | 命中 85% 时，被 cache 的旧 token 每请求几乎不再花 prefill；"每次重发 30K Maven log"在 prefix cache 下**不是**每次重付 30K | 折叠收益定义为推迟原生 compaction 与缩短 KV（§6 表），不是 token 数 |
| recall cost | 每次 `pctx_history read` 一次 tool 往返 + 回读字节 | `historyReads/verifiedReads` 计数进报告 |
| compaction proximity | 折叠只在 60% 触发，远离 93.75% | `triggerPercent` |

逐请求重新评估会把"改前缀"从每 ~60k token 一次变成潜在的每请求一次——正是反馈自己引用的 #330 "pruning 的代价是 cache busting"。因此 6.1 保留阈值触发 + 一次折足 + 冻结，把经济学放到**报告**里（`removed/invalidated`、`Σuncached`、TTFT p50、prefill delta）而不是放到每次请求的决策里。若将来要接付费 API，`RequestRecord.usage.cacheRead/cacheWrite` 已是拟合成本模型所需的全部输入，不需要改折叠机制。

## 7. 与 Pi 阈值的相互作用

Pi 在下一次 assistant 响应前判断是否压缩：`prepareNextTurnWithContext` → `_compactBeforeNextAssistantResponse()`，输入为 `estimateContextTokens(agent.state.messages)` = **上一条 assistant 的真实 provider usage + 其后原生消息的字符估算**（`agent-session.ts:542-559`、`compaction.ts:202-230`）。这一步在 `transformContext`（`context` 事件）**之前**执行。因此：

- 折叠当次请求，Pi 看到的仍是未折叠估算；折叠效果在**下一条** assistant 响应的 `usage.totalTokens` 中体现，之后 Pi 才据此推迟原生 compaction。
- trailing（最后一条 usage 之后的新工具结果）永远按原生正文估算，折叠不改变它。
- 所以 trigger 必须至少留出一个请求的余量：60% vs 93.75% 在 262k 窗口上是 ≈ 88k token，足够。若用户把 `reserveTokens` 调大或窗口调小，A01 的配置校验要拒绝 `triggerPercent ≥ (1 − reserveTokens/contextWindow) × 100 − 10`。

## 8. 不做的事及理由

- 不用 `tool_result` hook 缩短持久化内容：Pi 已截断 2000 行/50KB，首次可见性是显式取舍（v5 ADR-002）；改这里会破坏"原文在日志里"的回读前提。
- 不在每个 turn 边界重规划：本地栈上每次改前缀都是几十秒 prefill；阈值触发把这个代价降到每 ~60k token 一次。
- 不做 pin 胶囊/语义摘要：无文献支持，Pi 原生结构化摘要 + 精确回读已经覆盖；`ctx.modelRegistry.stream()` 未来若要做专用摘要模型实验，是另一个独立课题。
- 不做 overflow 恢复、within-turn 应急裁剪、compact-and-retry、"continue"自动重试：0.85.1 全部已由宿主实现（[05 §6.1 第 10 条](../audit/05-native-pi.md)）。
- 不在 6.1 做 "verified delta" checkpoint：其确定性子集作为 6.2 候选由 E03 的 `lost evidence` 列决定（[00-target §6.2](00-target.md)）。
