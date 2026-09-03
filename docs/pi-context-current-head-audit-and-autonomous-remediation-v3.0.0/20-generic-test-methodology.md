# 通用 Agent Context/Memory 测试方法

## 五层“无损”定义

1. 原始内容仍存在；
2. 当前 Prompt 可见；
3. 可寻址；
4. 可精确检索；
5. 行为等价。

测试和报告必须标明自己证明的是哪一层。

## 测试金字塔

- Pure reducer/property tests；
- Store transaction/crash tests；
- Host contract tests；
- Product acceptance；
- Packed clean install；
- Target-provider paired evaluation；
- Long-horizon pressure/fault；
- Publication bundle verification。

## 核心任务族

Directive、Correction、Temporal Update、Supersession、Branch、Tool Pair、Side Effect、Secret、Permission、Same-basename、Recall-needed、Recall-not-needed、Cache Prefix、Large Tool Output、Overflow、Recursive、Restart、Reader Abstention。

每族至少包含正例、负例和对抗例；Oracle 与输入模板分离；Scorer 不读取 candidate summary 作为答案捷径。
