# 确定性语义覆盖与 Claim Normalization

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 目标

在不调用 LLM 的情况下，覆盖约束、极性、时间、状态和 supersession 的有限但可靠子集。

## 2. Canonical Normalizers

- exact quote normalizer：Unicode NFC、换行规范化，不改变大小写敏感标识符；
- path normalizer：只规范分隔符，不解析不存在路径；
- numeric normalizer：保留单位与比较符；
- status normalizer：`failed/passed/pending/not-run`；
- polarity normalizer：`must/must-not/may/is/is-not/unknown`；
- time normalizer：绝对时间 + 原始文本；
- source-evidence normalizer：toolCallId + content hash。

## 3. Synthetic Markers

Benchmark Synthetic Trace 使用自然语言和隐藏 machine tags 的双轨：模型只看到自然语言，Harness 读取 sidecar Oracle ID。严禁把 `oracle-item-id` 放进模型消息。

## 4. 状态机示例

```text
constraint C1 active must-not deploy
user update C2 supersedes C1: deployment allowed after test suite passes
T1 test failed → permission remains inactive
T2 test passed → permission guard becomes satisfied
```

评分器必须区分：

- 仍禁止部署；
- 有条件允许但条件未满足；
- 条件已满足；
- 已执行部署。

## 5. 不支持范围

隐含讽刺、复杂常识、跨段因果和开放式意图不进入确定性 Gate；它们由 Reader 和闭环评测承担。
