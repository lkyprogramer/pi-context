# Benchmark Corpus 设计

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 四类语料

1. **Synthetic exact**：精确 Oracle、状态机、对抗条件；
2. **Template-generated coding**：可控长度、噪声和目标切换；
3. **Real redacted trajectories**：真实工具分布与自然语言；
4. **External benchmark adapters**：LongMemEval、ToolHaystack、MemGym 等适用子集。

## 2. 场景族

- long tool noise；
- delayed hard constraint；
- user correction and supersession；
- temporal fact and stale version；
- failure→diagnosis→fix→validation；
- two same basename paths；
- branch switch and external side effect；
- forbidden deployment/action；
- secret/prompt injection in tool output；
- unknown/abstention；
- repeated search/dedup；
- single huge turn；
- proactive recall needed/not needed；
- overflow and recovery。

## 3. 长度轴

每类至少覆盖：

```text
10 / 50 / 100 user turns
32k / 64k / 128k / 200k raw token bands（按模型能力适配）
20% / 50% / 80% tool-output share
```

## 4. 数据版本

Corpus 版本不可变。每个 Scenario 有 raw trace、oracle、workspace snapshot、hidden continuation 和 expected report hash。修复标注错误时发布新版本。

## 5. 防过拟合

- public train/dev 与 sealed gate set；
- Gate set 的 hidden continuation 不进入仓库的压缩器开发路径；
- Reducer 规则不得读取 scenario ID；
- 报告公开场景族结果，不公开 sealed 具体答案。
