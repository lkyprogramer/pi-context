# pi-context Current-HEAD Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Every step is tracked with checkbox syntax.

**Goal:** 把当前不可编译、评测主臂错误且发布链未闭环的 Alpha，推进到可复算的 RC 决策点。

**Architecture:** 先恢复 strict compile/pack/compatibility/branch truth，再完成 Runtime 边界与 Recall/Economics，随后拆分 Component Gate 和 Product Gate，最后运行 arm-specific long-horizon Live 与不可变 RC Bundle。所有 Publication 结论只由同一 HEAD 的机器 Gate 生成。

**Tech Stack:** TypeScript 5.9、Node 22/24、pnpm 10.15、Vitest 3.2、Pi 0.84.4 + pinned patch、SQLite、GitHub Actions。

**Spec:** `00-executive-summary.md`、`12-final-verdict-and-claim-policy.md`、`20-26` 测试规范。

## Global Constraints

- 默认仍是 Pi Native。
- `publicationClaim=false` 直到 C31 的所有前置条件成立。
- 不允许通过降低门槛、删除 timeout 或混用旧 commit 结果过门。
- B2 vs B0 是 Product Adoption 主比较；B1 仅诊断。
- Live 与 Hermetic Finding 分开关闭。
- 任务 Evidence 必须通过 `scripts/taskctl.py`。

## DAG

```text
W0 C01-C05
  ↓
W1 C06-C10
  ↓
W2 C11-C15
  ↓
W3 C16-C23
  ↓
W4 C24-C28
  ↓
W5 C29-C31
```

`C00` 是基线登记任务，可与 C01 并行；C24 是高成本 Live，必须等待 C15、C17-C23 全部完成。
