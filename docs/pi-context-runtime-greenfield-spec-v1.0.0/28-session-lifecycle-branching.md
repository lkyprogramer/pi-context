# Session 生命周期、Resume、Fork 与 Tree

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 startup/shutdown/catch-up、branch lineage、generation selection 和外部副作用提示。

## 2. 已冻结决策

- `session_start` 执行 capability probe、migration、catch-up、Saga recovery。
- `session_shutdown` 停止新任务、flush receipt、关闭 worker。
- Fork 创建新的 session scope，按 ancestry 继承 source refs。
- Tree navigation 切换 active generation，不自动 undo external state。

## 3. Startup 顺序

```text
claim single owner
→ derive dataRoot/workspaceId/sessionId/leaf
→ open keys/store
→ validate schema/FTS/capabilities
→ replay host entries after maintenance cursor
→ recover Saga
→ select active generation by ancestry
→ start bounded worker/maintenance
→ mark ready
```

## 4. Catch-up

已有 Pi Session 可导入：

- user message → untrusted/authenticated 取决于可验证 channel metadata；旧记录缺 channel 时默认 untrusted-user；
- tool result → pointer-unavailable evidence（无 raw CAS）；
- compaction/branch summary → agent-derived note；
- 不从旧 summary 自动创建 act authority；
- catch-up cursor 记录 last host entry ID，重复启动幂等。

## 5. Tree Change

切换后：释放不属于新 branch 的 leases；stale background candidates；重新计算 continuity；显示未回滚 SideEffect。Sibling branch 的 claim 只有显式 historical review 才可检索。

## 6. 不变量

1. Shutdown 超时后留下 recovery marker，不伪称 clean close。
2. Catch-up 不修改原 Pi Session。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `14-saga-and-recovery.md`
- `tasks/T33-session-lifecycle.md`
