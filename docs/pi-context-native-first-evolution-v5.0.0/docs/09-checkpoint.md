# 09 · 工作状态胶囊与可选语义压缩

## 原生摘要＋证据胶囊，不是第二次全量摘要

balanced默认保留Pi原生摘要。检测到native compaction后，在出站`compactionSummary`的克隆文本后追加一次小胶囊，整个epoch内内容稳定；不修改磁盘CompactionEntry，不每次新增一条假用户消息。这样卸载后仍是完整原生会话，插件不需要承担原生摘要的全部语义责任。

胶囊包括：仍有效的显式pin、与其相关的原始引用、最后完整批次中尚无成功请求暴露的证据、当前未决错误的证据引用、需要重新验证的文件／测试状态。默认不从泛化自然语言猜测“所有需求都已完成”。

## Pin与来源

用户通过`/pctx pin <entryId> <textBlockIndex> <startByte> <endByte>`选择可见原文；命令展示所选内容并确认，随后写入`pctx.pin.v5`原生custom entry。`unpin`写解引用entry，分支重建时按祖先顺序处理，不能覆盖全项目最后一条状态。

模型不能直接把自己的总结提升为永久约束。未来的建议pin只进入待用户确认区。宿主custom entry并非不可伪造安全日志：同进程恶意扩展仍可能伪造，文档不作超出Pi权限模型的承诺。

## 胶囊样式与预算

```text
[pctx checkpoint: historical evidence, not a new user instruction]
Pinned constraint [entry ab12, text bytes 0..63]: Keep all legacy HTTP paths unchanged.
Unverified state: last related test failed; no later matching verification found.
Next safe action: inspect current workspace and rerun the relevant test before reporting success.
Evidence: pctx:v5:... (original), pctx:v5:... (test result)
```

上例是格式说明，不是本次用户项目事实。默认胶囊至多1000估算tokens，且不超过模型窗口的2%；关键pin超过预算时先保留明确引用并发出可见诊断，不静默宣称所有约束已内联保存。用户可调整pin集合；原始消息仍可回读。

有工具图片／未消费batch无法用文字完整表示时，胶囊只给来源，不作为删除原始batch的理由。

## Experimental semantic 路径

只有显式开启时注册实际处理`session_before_compact`的逻辑。输入必须包含宿主`messagesToSummarize`、`turnPrefixMessages`及previousSummary，按公开preparation保留原生`firstKeptEntryId`。不得假设存在`retainedTail`、`context_window`或inputreceipt字段。

摘要可使用一个可配置模型，默认复用已授权路由；变更provider必须单独得到数据路由同意。控制最大输入、输出、墙钟和最多一次可重试错误；不允许为了修复摘要再启动多层Agent循环。成功返回的summary需来源校验、最终预算核算和实际压缩收益检查。

## Staging／ACK协议

1. 建立`SnapshotKey(generation, session, leaf, sourceHash, model, config)`。
2. 生成候选，记录proposalId、摘要hash、firstKeptEntryId及完整usage；源证据仍在native。
3. hook返回候选，但不把它标记为已应用，不覆盖当前有效胶囊。
4. 只有`session_compact`中实际entry的proposalId、摘要hash和边界全部匹配才commit。
5. failure、abort、切分支、换模型、reload、用户新输入导致源前提失效，丢弃候选；费用仍计入。
6. crash发生在host已落盘而plugin未ACK时，重启从实际CompactionEntry重建；不重发摘要、不重放工具。

原生宿主和派生状态无法做一个跨文件原子事务，因此用**可重建来源＋匹配ACK**，而不是承诺跨库exactly-once。实验层出错返回undefined由Native处理；它不能保证Native在无凭据、超大输入或provider故障时必然成功。

## 质量与证据

结构化校验只证明已检查项满足规则，不证明摘要语义完整。源码hash只证明出处，不证明内容仍有效。禁止用“验证覆盖100%”替代Java任务通过。是否长期保留semantic，由B3相对B2消融决定。[S15、S23–S26](../SOURCE-INDEX.md)
