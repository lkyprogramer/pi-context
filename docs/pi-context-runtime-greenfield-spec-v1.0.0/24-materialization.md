# Request-time Materialization 与 Prompt Cache 布局

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义每次 `context` Hook 的工作集、active suffix、四区布局、分配顺序、缩减阶梯和 receipt。

## 2. 已冻结决策

- Active-turn suffix 始终保持 Pi 原始 role/tool pairing。
- 稳定前缀只按 committed generation 变化。
- 每请求可变 directory/retrieval/lease 位于历史 tail 后。
- 当前真实用户消息是 active user-intent anchor，但工具循环中不要求成为最终 message。
- Hard Directive 和 atomic suffix 不能静默丢弃。

## 3. 四区布局

```text
[stable-prefix]
  runtime preamble
  active hard directives
  committed stable continuity snapshot

[append-only-history]
  bounded historical recent atomic tail

[volatile-augmentation]
  continuity delta
  directory
  proactive/leased retrieval pages
  runtime warnings

[active-turn]
  exact latest user turn suffix
  assistant tool calls and matching tool results
```

## 4. Active Suffix Algorithm

从消息尾部向前找到最近真实 user message；包含它之后的 assistant/toolResult/custom-aside，验证每个 ToolResult 对应此前 assistant toolCall。若 suffix 自身超过预算，先把超大 tool result 替换为已存在 raw pointer；仍不适配则 `UNREPAIRABLE_ACTIVE_TURN`。

## 5. Allocation Order

1. active-turn；
2. hard directives；
3. runtime preamble；
4. stable continuity；
5. recent historical atomic groups；
6. continuity delta；
7. high-confidence retrieval；
8. directory；
9. optional notes。

## 6. Receipt

记录 `viewId`、`outputHash`、section hashes/tokens、firstDifferentSection、eligiblePrefixTokens、omissions、route/model、cursor/head revisions、layout version。View section bytes使用 content-addressed dedup 和独立 retention。

## 7. 不变量

1. 同一输入快照和配置产生相同 outputHash。
2. Fallback view 仍必须 role-valid、tool-balanced、directive-complete。

## 8. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 9. 关联资料

- `schemas/materialized-view.schema.json`
- `diagrams/cache-zones.mmd`
