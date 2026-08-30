# Runtime 集成审计

## 真实运行入口做了什么

当前 Composition Root：

- 创建 `ContextMaterializer({directives:"keep"})`；
- 固定 workspace/session/leaf/lineage/contextWindow；
- `stageViewReceipt()` 空实现；
- compaction 时动态 import candidate，并创建只有 directive quotes 的 checkpoint；
- 把每个 directive 强制为 `must-not`；
- claims/pointers 为空，heads/continuity 固定；
- lifecycle 四个方法均空；
- CandidateWorker 使用内存假 store；
- Search/Recall tools 没有 evidence backend；
- 没有注册 Tool Result Capture 或 Input Correlation。

## 为什么这会直接导致 Live W2 失败

Temporal case 的用户输入是 correction。正则只捕获 marker，Composition Root 又把它当 prohibition，于是 checkpoint 只剩类似：

```text
[ud_x] instead (must-not/active)
```

模型不可能从中恢复 version value。更广泛地说，只要事实不属于显式 prohibition pattern，当前 checkpoint 都不会保存；这不是 deterministic compaction 的理论上限，而是 Composition Root 尚未接入 Runtime Store 的结果。

## 纵向修复目标

一条真实 tool_result 必须可以在一次 acceptance test 中证明：

```text
Pi event
→ RuntimeSession.ingestToolResult
→ encrypted blob
→ reducer view
→ EvidenceRecord
→ FTS index
→ compact Pi visible result
→ context_search hit
→ context_read exact bytes
→ compaction checkpoint pointer
→ session restart recovery
```

任何一环缺失，该 Wave 不允许完成。
