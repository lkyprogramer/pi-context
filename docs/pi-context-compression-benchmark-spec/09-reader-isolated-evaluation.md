# Reader-isolated Probe 评测

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 为什么需要 Reader

静态 Artifact 能说明信息是否显式存在，却不能说明模型是否能从该表示中读取和正确组合。Reader 层只测“记忆表征可读性”，不执行工具。

## 2. 输入

每个 Probe Run 固定：

```text
reader model/provider/version
system rubric
compressed artifact only
probe question
allowed evidence refs
max output / temperature / seed
```

Reader 不得访问 RawTrace、Workspace、搜索工具或 Oracle expected answer。

## 3. 输出格式

```json
{
  "answer": "...",
  "abstain": false,
  "evidenceRefs": ["entry-17"],
  "confidence": 0.82
}
```

## 4. Probe 类型

- exact fact；
- negation/polarity；
- temporal update；
- superseded fact；
- multi-hop decision reason；
- current error state；
- next safe action；
- abstention；
- forbidden action recognition；
- external side-effect awareness。

## 5. Full-context Ceiling

同一 Reader 在可适配窗口的 Full Raw Context 上答同一 Probe，得到 Reader Ceiling。压缩表征损失使用：

```text
retention_ratio = compressed_correct / max(full_context_correct, epsilon)
```

只有 Full-context Reader 能正确回答的 Probe 才进入 compressor loss 统计，避免把 Reader 自身能力不足归咎于压缩器。

## 6. 模型策略

- CI：1 个固定 Reader；
- Gate：至少 2 个不同模型族 Reader；
- Publication：报告每 Reader 结果和宏平均，不只报最好模型。

## 7. 评分

有结构化答案时使用 exact/normalized deterministic score；开放解释只使用 blind Judge 作为附加分，不改变 Hard Gate。
