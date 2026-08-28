# 执行摘要

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 当前文档是否已经足够

**不够。** 原 PCR 包已经写明 paired comparison、bootstrap 95% CI、non-inferiority、boundary-local continuation 和“不能只用一个 LLM Judge”，方向正确；但仍缺少以下实现级内容：

- W1 与 Pi Native 的正确实验臂定义；
- 原始轨迹如何冻结、回放和恢复到同一环境；
- Pi Native 摘要与 W1/W2 产物如何标准化；
- 哪些指标可直接计算，哪些需要 Reader/Executor/LLM Judge；
- Oracle 的 Claim、极性、时间、supersession、禁止动作和环境断言格式；
- 评分公式、阈值、置信区间和判门优先级；
- Recall-needed 与 Recall-not-needed 的对照；
- Pi JSONL、Workspace、Provider Session、Prompt Cache 的隔离方法；
- 失败归因如何区分 Compressor、Retriever、Reader、Executor；
- AI Agent 可逐项实现的文件边界与 TDD 任务。

## 2. 直接回答“能否算法直接对比”

可以直接计算的部分：

```text
输入/输出 token、压缩率、字节数、延迟、缓存 token、费用
工具调用与结果配对、最新用户消息位置、Schema/JSON 合法性
路径/ID/数字/错误串等精确字面量保留
Oracle 结构化 Claim 的极性、状态、时间与 supersession 覆盖
Blob/Range 的逐字恢复及 SHA-256 一致性
FTS/Exact Recall 的 Recall@k、MRR、nDCG、Precision
环境断言：测试是否通过、文件是否正确、禁止动作是否发生
```

不能仅靠普通算法证明的部分：

```text
自由文本摘要是否完整保留隐含因果关系
同义改写是否真正表达相同约束
摘要是否足以支持模型做出正确的下一步
模型是否会在未知未知时主动召回
```

因此完整证据链采用三层：

```text
L0 静态确定性评分
L1 固定 Reader 的隔离问答
L2 同环境的 paired closed-loop continuation
```

LLM Judge 是可选的 L3 辅助，不是主门。

## 3. W1 与 W2 必须分开

### W1 Early Net Value Gate

W1 没有独立 Compactor，因此比较：

```text
A0 Pi Native
A1 Pi Native + W1 Reducers/CAS，不主动 Recall
A2 Pi Native + W1 Reducers/CAS + Proactive Recall
```

这证明入口减噪、可恢复性和主动召回是否有净价值。

### W2 Compactor Head-to-head Gate

W2 完成 deterministic materializer/host checkpoint 后，比较：

```text
B0 Pi Native Compaction
B1 PCR Deterministic Host Checkpoint（同一 W1-shaped 输入、同切点、同目标预算）
B2 PCR Full Deterministic Runtime（端到端）
```

B0/B1 是压缩算法隔离实验；A0/B2 是系统端到端实验，二者不能混为一个数字。

## 4. 最终发布判断

Gate 按词典序判断，质量和安全不可被 Token 节省抵消：

1. 数据完整性、安全、禁止动作；
2. Hard Directive/Tool Pair/Recoverability；
3. 任务质量非劣；
4. Recall 有效且不过度注入；
5. Token/Cost/Latency 净收益为正。

任一更高优先级失败，直接拒绝该实验臂。
