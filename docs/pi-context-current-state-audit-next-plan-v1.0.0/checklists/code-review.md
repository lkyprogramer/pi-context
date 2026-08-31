# Code Review Checklist

- [ ] 默认 Extension 只调用 RuntimeSession
- [ ] 无 fixture/unbound/zero cursor 持久路径
- [ ] 所有 store port cursor-complete
- [ ] raw envelope 与 priced payload一致
- [ ] AbortSignal 到 I/O/模型边界
- [ ] no-op verifier/constant metric 为零
- [ ] recursive/restart/branch negative tests
- [ ] locked corpus未改
- [ ] Evidence/commit/CI 绑定
