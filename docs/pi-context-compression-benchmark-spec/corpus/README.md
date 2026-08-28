# Benchmark Corpus 模板

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


本目录给出 12 个最小 Scenario 模板，覆盖延迟约束、更新、工具证据、入口降噪、路径碰撞、secret 注入、主动召回、分支外部状态、超大 Turn、时间和拒答。模板只定义结构；B16 将其扩展为版本化 RawTrace、Workspace Snapshot、Oracle、Probe 和 sealed continuation。

## 语料分层

- `synthetic-exact`：CI 使用，完全确定性；
- `template-coding`：从模板生成真实仓库和工具输出；
- `real-redacted`：真实长轨迹脱敏后双人标注；
- `external-adapter`：LongMemEval/ToolHaystack/MemGym 等只通过 Adapter 接入，不修改原数据。

所有模板必须验证 `schemas/benchmark-scenario.schema.json`。
