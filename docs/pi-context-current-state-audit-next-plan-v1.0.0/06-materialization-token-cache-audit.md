# Materialization、Token 与 Cache 审计

## 关键正确性问题：Envelope under-pricing

Pi 的 `compactionSummary` 文本通常在 `summary` 字段，assistant tool call 也可能不是 normalized HostBlock。Codec 可以把 raw 对象保存在 Envelope，但 Pricer 只遍历 normalized `message.content`。

因此：

```text
provider sees: raw compactionSummary/toolCall/etc.
pricer sees:   empty or partial normalized blocks
```

这会造成：

- `tokenEstimate` 偏低；
- Reduction 不触发或触发顺序错误；
- Cache Receipt eligible tokens 错误；
- 真实 overflow 风险；
- Live `probe input` 无法与 Materializer estimate 对账。

## 容量与成本必须分开

```text
capacity_tokens = full serialized request tokens
cost = uncached_input*price + cache_read*price + cache_write*price + output*price
```

当前 runner 只读 `usage.input`，忽略 cacheRead/cacheWrite；既不是容量，也不是完整成本。

## 推荐布局

```text
[stable system/tools/protocol]
[stable active directives/committed continuity]
[append-only atomic recent history]
[volatile delta/directory/recall]
[complete active turn]
```

每个 section 必须记录 raw payload hash、priced token、first-different、cache read/write、provider tokenizer revision。
