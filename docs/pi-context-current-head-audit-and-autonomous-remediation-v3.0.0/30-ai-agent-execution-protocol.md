# AI Agent 自主执行协议

## 并行规则

- 同一 Wave 内无依赖任务可并行；
- 修改 `composition-root.ts` 的 C01/C06/C08 不得并行写同一 worktree；
- C15/C24/C25-C28 使用外部 Provider，必须串行限流并独立 runEpoch；
- 每个任务独立分支 `agent/Cxx-short-name`；
- 合并顺序按 DAG，不做大爆炸合并。

## 两阶段 Review

1. Spec Review：检查是否严格满足 task Acceptance、没有扩大范围；
2. Quality Review：检查类型、故障路径、测试真实性、证据 hash、claim level。

## 自动停止条件

- strict compile 红；
- 当前 HEAD 与 run manifest 不一致；
- provider/model/corpus/scorer hash 变化；
- timeout 集中或 rate limit 未分类；
- raw artifact secret scan 非零；
- branch protection API 不可访问；
- Publication Gate 读取到任何旧 run。
