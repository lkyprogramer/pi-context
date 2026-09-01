# Corpus、Oracle 与数据治理

## Split

| Split | 可见性 | 是否可调规则 | 用途 |
|---|---|---|---|
| train | 公开 | 是 | parser/reducer 开发 |
| dev | 公开结果 | 是 | 配置/阈值选择 |
| locked-test | Runner 可见 Oracle | 否 | Gate |
| real-traces | 脱敏、按 task lineage | 否 | 外部有效性 |

## Cluster

同一模板、同一仓库任务、同一会话复制、同一错误的参数变体属于一个 Cluster。不能把 20 个编号变体当 20 个独立样本。

## Case Bundle

每个 Case 至少包含：

```yaml
caseId:
clusterId:
workspaceSnapshot:
piSessionJsonl:
runtimeStoreSnapshot:
modelAndConfig:
cutBoundary:
oracle:
  sourceWitnesses:
  hardDirectives:
  supersession:
  mustOmit:
hiddenContinuation:
  userPrompt:
  environmentAssertions:
```

## Oracle Validator

运行 Arm 前先验证：

- expected value 在 source refs 中；
- latest/superseded 关系可证明；
- assertion 能由 workspace/command/DB/mock side effect 判定；
- secret marker 与普通业务内容不冲突；
- retained tail 与 tool pair 边界合法；
- F0 在窗口中 answerable。

Corpus 一旦冻结，失败后不得原地编辑同一 major；必须 bump 版本并保留旧结果。
