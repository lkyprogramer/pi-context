# LLM-as-Judge 使用协议

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 允许用途

- 因果链是否清楚；
- 摘要是否可执行、是否存在歧义；
- Oracle 未覆盖的自然语言信息是否明显缺失；
- 失败轨迹聚类与定性解释。

## 2. 禁止用途

- Token/费用/延迟；
- SHA/Blob 恢复；
- Tool Pair；
- 禁止动作是否执行；
- 测试是否通过；
- 覆盖确定性 contradiction 或 unsupported outcome；
- 作为唯一 W1/W2 Gate。

## 3. 盲评输入

Judge 获得：RawTrace 的受限 evidence excerpt、匿名 Artifact X/Y、固定 rubric。不得看到 Arm 名、成本和开发者说明。

## 4. 输出

```json
{
  "coverage": 0,
  "causalContinuity": 0,
  "actionability": 0,
  "unsupportedClaims": [],
  "missingEvidenceRefs": [],
  "preference": "X|Y|tie",
  "rationale": "..."
}
```

## 5. 可靠性

- 至少 2 个独立 Judge；
- 生成摘要的模型不能是唯一 Judge；
- 在 100 条人工标注样本上校准；
- weighted kappa 或 Krippendorff alpha 初始目标 `>= 0.70`；
- 分歧时进入人工/第三 Judge，原始记录不可覆盖；
- Judge Prompt、模型版本和原始输出全部哈希留存。

## 6. 决策权

Judge 偏好只能排序已通过硬 Gate 的候选。若 X 更可读但违反用户禁止部署约束，X 仍然失败。
