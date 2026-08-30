# W2 Live Native Pairing 深度复核

## 报告做对的部分

- 明确区分 synthetic 与 live Native；
- 使用独立 Pi home、同一 JSONL seed、同 cut、同 tokensBefore；
- 明确 publicationClaim=false；
- 主动披露 summary+probe 并集评分污染；
- 硬门失败后没有用效率指标强行 adopt。

## 新发现的评测错误

### 1. Temporal Oracle 不可满足

Corpus 的 `latestValue` 为 `version=7-tu-xx`；冻结用户输入只有“改为 version 7”，raw 只有 stale `version=3`。case-id 后缀从未出现。Reader 无论看到 Full Context、Native Summary 还是 PCR Checkpoint，都不应被要求生成不存在的 exact string。

正确 Oracle：

```json
{
  "expected": { "normalizedVersion": "7" },
  "witness": { "messageId": "u_start_tu-00", "quote": "改为 version 7" }
}
```

### 2. 100 样本伪重复

五个 family 每个只有一个语义模板，20 行主要换 id/语言。统计单位应是 scenario cluster；不能把 100 行当作 100 个独立任务。

### 3. 闭环评分污染

`honors` 在 summary 或 probe 任一处命中即通过。模型回答“是，可以合并”时，只要 summary 中仍有“不要合并”，closedLoop 仍可为 1。

### 4. Hard Gate 被假实现

- recovered = no leak；
- toolPairViolation = 0 常量；
- deterministic hash 未重跑；
- same source span = same cut rate；
- B2/recall 缺失。

### 5. 不是真实长程场景

6.2k tokens、manual compact、2k recent tail、no tools。它测试的是“短合成前缀摘要 + 文本问答”，不是 coding-agent 长程执行。

## 对当前结果的重新解释

- `keep-pi-native` 对**当前 candidate implementation**是正确的保守决策；
- 不能据此否定完整 PCR 设计，因为完整 runtime 未被接入；
- 不能据此证明 Native 更安全，因为 Native 没有同等 ingress scrub；
- Temporal 20/20 失败应标记 `invalid-oracle-run`，不进入算法质量统计；
- 其余 80 对仍只能作为 smoke evidence，不能成为 W2 Gate。
