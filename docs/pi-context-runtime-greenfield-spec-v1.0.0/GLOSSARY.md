# 术语表

| 术语 | 定义 |
|---|---|
| PCR | Pi Context Runtime，产品与本规格简称 |
| Host | Pi 宿主；未来可增加其他 Adapter |
| Host Transcript Authority | Pi Session JSONL 对消息顺序、branch、compaction entry 的权威 |
| PCR Store | per-workspace SQLite/CAS，raw observation 与派生 memory 的事实源 |
| Materialized View | 每次 LLM request 前生成的临时 AgentMessage[] 工作集 |
| Host Checkpoint | 通过 Pi CompactionEntry 收敛 active messages 的结构化视图 |
| Directive | 带 exact quote/byte range 的 authenticated user 指令 |
| Evidence | 来源绑定的不可变事实单元 |
| Claim | 支持 refs、极性、时间、状态、authority 的语义陈述 |
| Continuity | 当前任务工作面、错误、side effect、validation、next action |
| Lease | 目的绑定的临时召回注入 |
| Saga | Pi JSONL 与外部 store 间的可恢复非原子提交协议 |
| Active-turn suffix | 最近真实用户 turn 及其 assistant/tool call/result 原子后缀 |
| Stable prefix | 只随 committed generation 变化的 memory sections |
