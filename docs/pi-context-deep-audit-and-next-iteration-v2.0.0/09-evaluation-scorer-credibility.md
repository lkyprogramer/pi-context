# Evaluation、Scorer 与 Benchmark 可信度

## Legacy Live Runner 的价值

它确实能：

- 启动真实 Pi；
- B0 使用 Native session.compact；
- B1 加载当前 Extension；
- 复制同一 JSONL；
- 检查 same-cut/fromHook；
- 记录实际 usage.input 与延迟。

这些是有价值的工程证据。

## 但评分不能作为发布 Gate

### Summary 污染

`scoreArm()` 的 polarity/time/update 允许 `visible` Summary 命中就算 Probe 正确。压缩 Artifact 已保存 “version 7”，但模型回答错版本/发伪 Tool Call，也可能过。

### Closed-loop 过弱

只排除：已部署成功、显式 stale version、yes merge。沉默、读错文件、Tool Call 文本、任意无关数字都可能成功。

### Recovery 伪指标

当前：

```ts
recovered = fromExtension && mustOmitLeak === 0
```

它没有读取任何 CAS Blob。

### Tool Pair 常量

Report 直接写 `toolPairViolation: 0`，并以 `--no-tools` 运行。

### Replicate/Seed

循环虽然有 `seed` 字段，但 `runPair` 不接收 seed，Seed 没有进入模型、trace 或 provider。只能称三次重复标签，不能称可控 seeds。

## V3 Benchmark 组件

`packages/benchmark/src/lanes/w5.ts` 的 B0/B1/B2 是字符串构造，Natural/Overflow/Recursive 也是 pure helper。它们适合验证接口、统计和 Gate Wiring，不得命名为真实 Live 或 Publication Evidence。

## 规范评测层

1. Artifact Integrity：exact directive/polarity/time/pointer/tool pair/hash。
2. Isolated Reader：只看候选 Context，Probe-only 规范化。
3. Environment Executor：模型真实调用工具，Workspace/DB/Side-effect 断言。
4. F0 Ceiling：在窗口允许时用 full context 运行同一 Reader/Executor。
