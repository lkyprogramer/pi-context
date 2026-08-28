# Pi Native 与 PCR 上下文算法正面对比协议

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 为什么不能直接比较两段文字

Pi Native 产物是 LLM 生成的 Summary + Retained Tail；PCR deterministic 产物是结构化 Checkpoint/Materialized View。二者表达形式不同。只比较字符相似度会惩罚正确同义改写，也无法发现“不得部署”被写成“已部署”。

## 2. 公平比较输入

正面对比必须共享：

```text
Canonical RawTrace hash
W1ShapedTrace hash
Boundary leaf/cut candidates
source span
retained-tail target
I_eff 与 target visible token budget
system/tool schema hash
model/provider/seed
```

Pi Native 若因生成长度不能精确命中预算，允许预注册的 `±5%` target band；超出 band 的 run 标记 `budget-mismatch`，不可与 B1 计算 artifact-only efficiency。

## 3. 三种比较视图

### 3.1 Artifact-only

比较 B0/B1 的：

- source span 覆盖；
- retained tail；
- visible tokens；
- Oracle Items；
- Tool Pair；
- exact recovery；
- generation latency/cost；
- deterministic stability。

### 3.2 Reader-only

固定 Reader 回答同一 Probe。Full-context 正确的 Probe 才参与 retention 计算。

### 3.3 Executor Closed-loop

同一 Snapshot、同一 hidden task、同一 Executor 继续运行。环境断言是主结果。

## 4. LLM 评审的正确位置

只有以下问题可交给盲 Judge：

- 因果链是否易理解；
- 下一步描述是否可执行；
- Oracle 未覆盖的开放式上下文是否明显遗漏。

Judge 不能裁定：测试是否通过、权限是否存在、secret 是否泄露、恢复是否逐字一致。

## 5. 最终判定

```text
B1 比 B0 更短，但 Closed-loop 劣于 -2% margin → B1 失败
B1 长度相近，质量更稳且 task-adjusted cost 为正 → 可通过
B1 静态覆盖好，Reader 好，但 Closed-loop 差 → 归因为 executor-interaction regression，仍失败
B1 Closed-loop 好但 exact recovery 失败 → integrity failure，仍失败
```
