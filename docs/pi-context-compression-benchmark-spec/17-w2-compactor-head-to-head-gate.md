# W2 Compactor Head-to-head Gate

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 目标

在相同 W1-shaped 输入、相同边界、相同有效预算下，正面对比 Pi Native Compaction 与 PCR Deterministic Host Checkpoint/Materializer。

## 2. 两类实验

### Compactor-isolated

```text
B0 W1-shaped messages → Pi Native summary + retained tail
B1 W1-shaped messages → PCR deterministic checkpoint + same retained tail target
```

只比较压缩器，关闭 Proactive Recall 和动态 Directory，或固定为相同输入。

### Runtime end-to-end

```text
E0 Pi Native raw stack
E2 PCR deterministic runtime
```

用于产品总效果，不用于单模块归因。

## 3. Static Hard Gate

```text
hard directive coverage == 1.00
unsupported high-risk outcome == 0
tool pair violation == 0
must-omit leak == 0
exact evidence recovery == 1.00
deterministic output hash stable == true
```

## 4. Reader Gate

- Full-context-correct Probe 上，PCR 对 Pi Native 非劣；
- polarity/time/update/abstention 分项不低于设定 margin；
- evidence citation precision 不劣。

## 5. Closed-loop Gate

```text
task success CI lower >= -0.02 vs Pi Native
constraint violation <= Pi Native
blocked/repeated action not significantly worse
steps/tokens to success no unacceptable regression
```

## 6. Efficiency Gate

至少满足其一，并且 Realized Net 为正：

- materialized input token median 比 Pi Native 少 `>= 15%`；
- task-adjusted cost/success 少 `>= 10%`；
- overflow recovery 成功率显著提高且质量非劣。

## 7. 结论

Artifact 文本更短但闭环失败，判 PCR 失败。Artifact 较长但质量明显更稳且 task-adjusted cost 为正，可以通过，但必须报告取舍。
