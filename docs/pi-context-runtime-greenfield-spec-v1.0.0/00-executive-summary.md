# 执行摘要

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

冻结 Pi 第一宿主路线、交付边界、核心技术选择、阶段门和不可妥协的不变量。

## 2. 已冻结决策

- 主产品名为 `pi-context-runtime`，内部内核不依赖 Pi。
- 第一宿主只使用 Pi 公开 Extension API；不修改 Pi 源码，不维护 Fork。
- 采用请求时物化与周期性 Pi 原生 Compaction 的混合架构。
- 原始 Tool Result 在 reducer 前进入加密 CAS，模型只看 compact view 与受限指针。
- Authenticated User Directive 原话与字节范围持久化，语义模型无权改写或退休。
- Pi JSONL 与 PCR Store 使用可恢复 Saga，不声称跨存储 ACID。
- 首发先证明 deterministic MVP 的净收益，再增加语义生成和后台候选。

## 3. 为什么从 DSH 转向 Pi

DSH 版本需要倒置请求构造控制流才能在最终 Provider/Model 确定后执行物化，长期 Fork 合并成本过高。Pi 已公开提供每次 LLM 调用前的 `context` 变换、工具结果写入前的 `tool_result`、Compaction 接管和 Session 生命周期 Hook，因此完整主路径可作为独立包发布。

## 4. 推荐落地顺序

```text
Gate 0: Pi Hook 与 Session/Branch 能力 Spike
Gate 1: Raw CAS + Reducers + Exact Recall + Context Materializer
Gate 2: Directive/Evidence/Claim/Continuity + Action Gate
Gate 3: Background Candidate + Semantic Proposal + Verifier
Gate 4: Compatibility Matrix + Security/Benchmark + Release
```

首个可发布版本只要求 deterministic path。Semantic path 只能是 optional candidate，不得成为容量安全、用户约束和 Overflow 恢复的单点依赖。

## 5. 不变量

1. 任何关键用户指令都不能仅依赖摘要或语义抽取而存活。
2. 每次 Context View 必须保持有效的 Tool Call/Tool Result 原子后缀。
3. Context Handler 和 Tool Result Handler 内部必须吞掉可恢复异常并显式选择 fallback；不得依赖 Pi 的异常传播来阻断请求。
4. 未知 Context Owner 冲突不能被描述为已解决；Strict 模式只对已知冲突与自身重复实例 fail closed。

## 6. 验证要求

- T03–T04 完成 Pi Contract Harness 与单一 Owner Probe。
- T45 deterministic MVP gate 通过后才进入 Semantic Beta。

## 7. 关联资料

- `04-target-architecture.md`
- `42-roadmap.md`
- `tasks/EXECUTION-PROTOCOL.md`
