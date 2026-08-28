# 报告与失败归因

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 报告结构

1. Run identity；
2. Gate decision；
3. Hard Gate failures；
4. Quality non-inferiority；
5. Token/Cost/Latency；
6. Recall needed/not-needed；
7. Static/Reader/Closed-loop 分层；
8. Scenario-family breakdown；
9. failure attribution；
10. Judge supplemental results；
11. excluded infrastructure runs；
12. hashes and reproducibility。

## 2. Attribution Taxonomy

```text
COMPRESSOR_OMISSION
COMPRESSOR_CONTRADICTION
COMPRESSOR_STALE_FACT
INGRESS_LOSS
BLOB_RECOVERY_FAILURE
RETRIEVAL_MISS
RETRIEVAL_STALE
POLICY_NO_RECALL
READER_MISREAD
EXECUTOR_REASONING
TOOL_ENVIRONMENT
HOST_INTEGRATION
INFRASTRUCTURE
```

## 3. 不得隐藏的结果

- 每个 Arm 的失败数和超时；
- Gate 失败的单例；
- 负 Token 节省场景；
- Recall 不必要注入；
- LLM Judge 分歧；
- 结果对模型/Provider 的敏感性。

## 4. Machine-readable First

`benchmark-report.json` 是权威，Markdown/图表由它生成。手工编辑 Markdown 不改变 Gate。
