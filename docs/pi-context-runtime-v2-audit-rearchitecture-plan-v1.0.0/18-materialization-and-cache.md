# Materialization 与 Prompt Cache

## 四区布局

```text
stable-prefix:
  runtime protocol
  exact active directives
  committed continuity generation
append-only-history:
  bounded recent atomic history
volatile-augmentation:
  continuity delta / directory / recall pages
active-turn:
  complete current turn，最后是最新 authenticated user message
```

## 计价

- 真实 content blocks，不用 message ID；
- system/tools/output reserve 进入 `I_eff`；
- tokenizer unavailable 时使用 conservative upper estimator；
- provider usage 用于 route-specific calibration；
- image/tool schema 单独计价；
- active-turn 超预算时 fail closed，不静默截断。

## Cache Receipt

记录 section hash、first different section、eligible prefix tokens、provider cache read/write、layout version。Cache 开关不得改变 outputHash。
