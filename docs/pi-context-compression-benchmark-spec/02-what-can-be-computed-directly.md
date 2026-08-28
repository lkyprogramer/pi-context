# 哪些可以直接计算，哪些不能

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 判定矩阵

| 问题 | 纯算法 | 固定 Reader | 闭环续跑 | LLM Judge |
|---|---:|---:|---:|---:|
| Token/字节/延迟/费用 | 主证据 | 不需要 | 可复核 | 禁止使用 |
| SHA-256 原文恢复 | 主证据 | 不需要 | 不需要 | 禁止使用 |
| Tool Pair/最新 User/Schema | 主证据 | 不需要 | 可复核 | 禁止使用 |
| 路径/ID/错误串/数值 | 主证据 | 可补充 | 可复核 | 非必要 |
| 结构化 Claim 极性/时间/状态 | 主证据（有 Oracle 时） | 可补充 | 可复核 | 非必要 |
| 自由文本同义关系 | 有限 | 主证据之一 | 主证据 | 可补充 |
| 因果链与下一步可执行性 | 不充分 | 局部 | **主证据** | 可补充 |
| 未知未知 Recall | 不充分 | 局部 | **主证据** | 可分析 |
| 最终任务正确性 | 不充分 | 不充分 | **唯一主证据** | 不得替代 |

## 2. 为什么不能用文本相似度

两个正确摘要可以措辞完全不同；一个错误摘要也可能复制大量原文而获得高 ROUGE。以下错误不能由普通相似度可靠发现：

- `tests failed` 变成 `tests passed`；
- `must not deploy` 丢失否定；
- 旧约束覆盖新约束；
- 数字、路径都出现过，但关系配错；
- 已执行动作只有 assistant 自述，无 tool evidence；
- 摘要保留了实体，却丢失下一步的前置条件。

因此禁止将 ROUGE、BLEU、编辑距离、单一 embedding cosine 或压缩率用作质量 Gate。它们只允许作为诊断附录。

## 3. 可直接算法化的语义比较

只要语料有结构化 Oracle，就可以把自由文本产物转换为受限的 Evidence Projection，并计算：

```text
mandatory_coverage
polarity_accuracy
temporal_accuracy
supersession_accuracy
contradiction_rate
stale_fact_rate
unsupported_outcome_rate
forbidden_action_exposure
```

对于 Synthetic/Template 场景，Oracle 使用精确 marker、canonical aliases 和有限状态机，因此不需要 LLM。

## 4. 任意自然轨迹的边界

真实轨迹中的隐含意图、因果和同义表达无法由规则穷尽。这时必须升级到 Reader 隔离和闭环续跑；LLM Judge 只能帮助解释，不负责最终裁决。
