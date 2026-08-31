# 测试严谨性与完整性审计

## 已有优点

- 同 JSONL、同 cut、隔离 Pi home；
- B0/B1 并行以降低时间漂移；
- 明确 publicationClaim=false；
- 已实现 source-witness、cluster、integrity、continuation 等新框架；
- 报告区分 synthetic W2 与真实 Pi Native。

## 关键缺口

### 1. 单元框架冒充 live

`tests/live/w2-paired.test.ts` 的 Native 是字符串函数，B2 只是加标记；`closed-loop.test.ts` Executor 预先知道正确写入内容。应重命名为 integration fixtures，避免证据等级混淆。

### 2. 无真正 F0/Reader

字符串 containment 不是模型读取 ceiling。需要用同一模型、同一 query、完整上下文、tools policy 明确的 Reader lane。

### 3. 无真实 Environment continuation

需要从冻结 workspace/session/store 恢复后，让模型自己选择工具，最后以 Git diff、test exit、forbidden side-effect 评分。

### 4. 缺生产压力

- default keepRecent；
- natural threshold；
- provider overflow；
- recursive compaction；
- branch/resume/restart；
- proactive recall needed/not-needed。

### 5. 数据独立性不足

5 个模板的参数化副本不能作为 30 个独立 cluster。需要真实任务 cluster、语言/工具/模型分层，并按 cluster bootstrap。
