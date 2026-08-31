# 当前架构评估

## 已成立的模块能力

- 稳定 RuntimeCursor 与 Host/Evidence/Directive ID；
- per-scope SQLite、加密 CAS、Saga；
- User/Tool ingress、deterministic reducers、Evidence/FTS；
- Unicode clause、DirectiveRecord、Temporal supersession；
- Continuity store/service；
- four-zone Materializer、CacheReceipt 类型；
- Checkpoint snapshot/renderer/verifier；
- Pi Hook adapter、Native fallback；
- Oracle、Integrity、Cluster statistics、Continuation assertions；
- staged release tarball builder。

## 尚未成立的产品形态

```text
Pi Hooks
  ├─ input/tool_result → ProductionUserTurnRuntime → SQLite/CAS/FTS
  ├─ context → ad-hoc ContextRegistry → messages-derived directives + empty continuity
  ├─ compact → ad-hoc ProductCompactionService → preparation-derived state
  ├─ lifecycle → stub recovery
  └─ background → hardcoded snapshot + memory map
```

目标应该是：

```text
Pi Hooks → one RuntimeSessionRegistry → one RuntimeSession
                                      ├─ ingress
                                      ├─ snapshot transaction
                                      ├─ materialize
                                      ├─ checkpoint
                                      ├─ retrieval
                                      ├─ recovery
                                      └─ receipts
```

当前最大问题不是缺少类，而是**相同 session 的事实分别存在于不同临时对象里**。
