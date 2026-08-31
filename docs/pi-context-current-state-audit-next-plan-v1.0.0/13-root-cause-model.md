# 根因模型

## 为什么 checkpoint 更短而下一轮不更省

1. Artifact 只比较 summary 本体；下一轮还包含 system/tools/recent tail/runtime additions。
2. Checkpoint 加入 hash、IDs、heads、pointers；这些对模型任务价值低。
3. Context hook 可能重复 user messages 为 directives/history/active turn。
4. `usage.input` 受 prompt cache 分类影响，不等于 full prompt size。
5. English temporal cases的工具/系统前缀可能 cache miss，造成 1.1K 级 input 波动。

## 为什么闭环看起来全对

Scorer 的成功条件接近“没有命中特定失败正则”，不是“回答正确”。Summary 又能给 temporal/polarity 补分，因此自然出现 30/30。

## 为什么模块多但产品闭环仍不完整

开发以 Task/Package 横向推进，验收多是每模块注入 fake port；默认 Extension 为快速接线又建立了一套 ad-hoc composition，导致真正 Store-backed state 没有贯穿全部 Hook。

## 为什么 Finding 全关闭但 CI 红

Closure Evidence 多证明“文件/测试存在”，而不是“current HEAD required CI + final acceptance + live run bundle 同时通过”。治理条件不足。
