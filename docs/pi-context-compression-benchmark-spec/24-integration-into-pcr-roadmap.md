# 集成到 PCR Roadmap 的修改建议

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 新增独立 Benchmark Workstream

不要等 T42 才开始构建评测。Benchmark Harness 应与 W0/W1 并行开发，先冻结 RawTrace、Oracle 和 Pi Native Arm。

## 2. 建议插入点

```text
W0:
  B01–B05 基础合同、Raw Trace、Snapshot、Oracle、Pi Native Arm
W1:
  B06–B10 W1 Arms、Static、Recoverability、Recall
  → W1 Early Gate
W2:
  B11–B14 Reader、Closed-loop、W2 Compactor Arms、Stats
  → W2 Head-to-head Gate
W4:
  B15–B18 Judge、Corpus、Report、Release Integration
```

## 3. 原 T42 调整

原 T42 不再从零实现全部 Benchmark；它只集成已经完成的 Benchmark Package、运行长程 Suite、Ablation 和 Attribution。

## 4. 原 T45 调整

T45 直接读取 `gate-decision.schema.json` 的已签名/哈希结果，不重新解释原始数据，也不能修改 Benchmark 阈值。

## 5. Gate 顺序

```text
W1 Gate 失败：不进入 Claim/Continuity 大规模开发
W1 Ingress 通过、Recall 失败：保留 Reducer/CAS，Recall 返工
W2 Compactor 失败：继续使用 Pi Native + W1
W2 通过：再进入 Semantic/Background
```
