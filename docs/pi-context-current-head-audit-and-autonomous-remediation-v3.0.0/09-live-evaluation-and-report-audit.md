# Live Evaluation 与报告准确性审计

## Paired 100×3

当前报告做对了三件事：绑定 current HEAD、明确 attempted/scored、保持 `keep-pi-native` 与 `publicationClaim=false`。

但 280/300 只能称为“不完整 current-head run”：

- 20 arm timeout 必须逐 ID、Arm、Family、Stage 报告；
- 质量统计必须包含 ITT；
- Retry 是否发生、为何发生、是否同输入必须入 manifest；
- B2 vs B0 才是产品主结论；
- B1/B2 相同 compact text 需要通过 layer breakdown 解释下一请求差异。

## Natural Pressure

Native tool-heavy 在约 187k tokens 发生 compact 是有效观察。PCR 没有 Host compaction JSONL 不一定是失败：若 B2 Materializer 始终把请求控制在窗口内、无 overflow 且质量不劣，说明它避免了 Host compact。

因此报告应输出每臂状态：

```text
native.autoCompactObserved
pcr.checkpointObserved
pcr.maxLogicalInput
pcr.maxProviderInput
pcr.overflowObserved
pcr.taskIntegrity
```

总 `triggered` 布尔值应删除。

## Overflow

当前两臂均未观察到 provider context-length 错误，所以只能证明“本次没有触发”。下一版分成：

1. Prevention：B2 在长历史下不溢出；
2. Forced Recovery：受控 provider 明确返回 context_length 后，PCR compact/retry 且无重复副作用；
3. Target Provider Observation：目标 provider 上的实际错误或明确未触发结果。

## Recursive

手工 grow + compact 三次是组件稳定性证据，不是 autonomous long-horizon。报告必须标注 `triggerMode=manual`。发布级 lane 禁止调用 RPC `session.compact()`，只允许自然压力或 PCR 自身策略触发。
