# Retrieval 与 Proactive Recall

## 阶梯

```text
exact ID/range
→ literal/path/symbol/error/command
→ FTS5/BM25 + scope/status/time filter
→ optional query expansion
→ optional semantic discovery
→ exact evidence read
```

Embedding 只能发现候选，不能证明事实。

## Proactive Recall

每个新顶层 user turn 生成 bounded query：用户关键名词、当前文件、active errors、task front。只有高置信且不在当前 context 的 evidence 才注入。记录：needed/not-needed、precision、token-turns、repeat suppression、task delta。

## Tools

`context_search` 返回 opaque IDs 与短 excerpt；`context_read` 执行 byte-range exact read，验证 hash、scope 和 lease。工具结果本身也受 ingress reducer。
