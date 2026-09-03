# Runtime 架构一致性审计

## 一致部分

1. **单一 Runtime Session**：默认 User/Tool 路径不再直接操作零散 service。
2. **同代 Snapshot**：Materialize/Compact 开始共享 SQLite 事务视图。
3. **Durable Stage/Ack**：不再仅依赖进程内 staged 变量。
4. **Session Scope**：生命周期状态从单全局游标迁出。
5. **Fail-closed Tail**：Unpaired Tool 和损坏尾部阻止 PCR takeover。

这些改造与“Store 是权威历史、Materializer 只构造工作视图、Compaction 只是新 checkpoint generation”的设计一致。

## 当前阻断

### Event 与 ExtensionContext 混用

`session_shutdown` 路径把 Event 强转为 `ExtensionContext`。这既是编译错误，也是边界建模错误。正确接口必须把 `(event, context)` 分开传递，Runtime 只消费最小 `SessionScopeContext`。

### Tool Context 依赖不存在的 cwd

工具回调不能假设 Host ToolContext 有 `cwd`。Workspace 应从注册时捕获的 Session Context 或 `WorkspaceResolver` 获取，并用 sessionId/leafId 做确定性索引。

### Implicit any

Callback 的 `workspaceId/input/cursor` 必须由 contracts 包导出的显式类型约束。否则 Pi Host API 变化会绕过编译器进入生产。

## 建议内部边界

```ts
export interface SessionScopeContext {
  sessionId: string;
  sessionDir: string;
  leafId: string;
  lineageHash: string;
  workspaceId: string;
  modelKey: string;
}

export interface WorkspaceResolver {
  resolve(context: Pick<ExtensionContext, "cwd" | "sessionManager" | "model">): SessionScopeContext;
  resolveTool(sessionId: string): SessionScopeContext;
  release(sessionId: string): Promise<void>;
}
```

Event handler 不允许通过类型断言制造 Context；所有入口先经 resolver，再调用 RuntimeSession。
