# Pi Context Runtime（PCR）Greenfield 实现规格 v1.0.0

Pi Context Runtime（简称 **PCR**）是一个以 Pi 为第一宿主、宿主无关内核为长期基础的上下文运行时。它不是“另一份摘要 Prompt”，而是把原始证据、用户指令、工作连续性、检索、请求物化和宿主 Compaction 分成不同职责。

## 最终定位

```text
Pi public Extension API
    │
    ▼
Pi Adapter（薄、可替换、持续兼容验证）
    │
    ▼
Host-agnostic Context Runtime Kernel
    ├── Raw Evidence / encrypted CAS
    ├── User Directive Ledger
    ├── Evidence / Claim / Continuity
    ├── Exact-first Retrieval
    ├── Request-time Materialization
    ├── Periodic Pi-native Host Checkpoint
    └── Recovery / Security / Telemetry
```

项目不修改 Pi 源码，不维护 Pi Fork，不导入 Pi 私有路径。Pi Adapter 只使用公开的 `context`、`tool_result`、`tool_call`、`session_before_compact`、`session_compact`、`session_start`、`session_tree`、`agent_settled`、`appendEntry()` 等 Extension API。

## 最重要的设计变化

1. **请求时虚拟物化**：每次 LLM 调用前通过 `context` 返回有界工作集。
2. **写入时入口降噪**：通过 `tool_result` 先冷存原文，再返回确定性 compact view。
3. **周期性宿主收敛**：通过 Pi 原生 Compaction 真正缩小 `agent.state.messages`，避免 Pi 在 Context Handler 前复制全历史带来的线性成本。
4. **双事实源边界**：Pi JSONL 是宿主会话与分支事实源；PCR Store 是 raw observation、directive、claim、continuity 和 receipt 的事实源。
5. **可恢复 Saga**：Pi JSONL 与外部 SQLite/CAS 不伪装成跨存储 ACID，而是 prepared → host-visible → acknowledged → committed/recovered。
6. **单一扩展编排器**：整个系统只注册一个 Pi Extension，内部模块不分别抢占 `context` 或 `session_before_compact`。

## 从哪里开始

| 读者 | 起点 |
|---|---|
| 架构评审 | `00-executive-summary.md` → `04-target-architecture.md` → `09-single-owner-governance.md` |
| Pi 集成开发 | `07-pi-public-api-mapping.md` → `25-pi-context-hook.md` → `26-pi-tool-result-hook.md` → `27-pi-compaction-takeover.md` |
| 内核开发 | `06-host-agnostic-contracts.md` → `12-storage-engine.md` → `18-evidence-model.md` → `24-materialization.md` |
| AI Agent 执行 | `tasks/EXECUTION-PROTOCOL.md` → `plans/00-master-implementation-plan.md` → 对应 `tasks/Txx-*.md` |
| 测试与发布 | `37-testing-strategy.md` → `38-benchmark-evaluation.md` → `40-release-gates.md` |

## 交付范围

本 ZIP 是实现级规格、任务、Schema、示例、参考骨架和离线验证资产，不包含已完成的产品源码。所有性能阈值均是需要通过 Spike 或 Benchmark 校准的发布门，不是已验证的结果。
