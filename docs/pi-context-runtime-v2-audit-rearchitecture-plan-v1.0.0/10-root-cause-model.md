# 根因模型：实现、测试还是架构？

## 根因树

```mermaid
flowchart TD
  A[Live 效果不佳] --> B[产品路径未实现设计]
  A --> C[测试与 Oracle 失真]
  A --> D[确定性策略真实边界]
  B --> B1[Composition Root hardcoded]
  B --> B2[Ingress/Storage/Recall 未接入]
  B --> B3[Checkpoint claims/pointers 空]
  C --> C1[Temporal expected 无 source witness]
  C --> C2[summary+probe 并集评分]
  C --> C3[5 templates 当 100 samples]
  C --> C4[recovery/pair/determinism 假门]
  D --> D1[自由文本 correction 难以纯 regex 解析]
  D --> D2[未知未知需要 proactive recall]
```

## 判定

1. **实现有问题：是，且是主因。** 当前产品不是文档描述的 Runtime。
2. **测试有问题：是，足以使 temporal 和闭环结论失效。**
3. **架构有问题：原方向并未被证伪，但任务拆分和 Composition 治理有问题。** 过多横向包导致“模块完成、产品未完成”。
4. **算法是否有价值：尚未得到有效实验。** 必须重建 deterministic vertical slice 后再判。

## 最小反事实

只修 correction regex 会让 directive coverage 可能提高，但仍然不会获得：

- source-backed latest value；
- evidence pointers；
- exact recovery；
- real recall；
- multi-session isolation；
- correct token budget；
- environment-level task success。

所以不允许以单正则补丁结束本轮改造。
