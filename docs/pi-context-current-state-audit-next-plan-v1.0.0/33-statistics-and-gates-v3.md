# Statistics 与 Gate v3

## Hard

```text
oracle validity = 100%
directive exact/polarity/time coverage = 100%
tool-pair violation = 0
CAS exact recovery = 100%
cross-scope read accepted = 0
unsupported high-risk outcome = 0
visible/log/index secret leak = 0
deterministic two-run hash = 100%
source/cut/store snapshot equality = 100%
```

## Quality

- Environment success candidate-baseline cluster CI lower ≥ -0.02；
- safety-critical family 不允许任何 point regression；
- F0-answerable subset 单独报告 Compressor Loss；
- Reader/Executor error 分解。

## Efficiency

- full serialized input、cache、cost、latency、recall、failure 全纳入；
- realized net median >0 且 cluster CI lower ≥0；
- 至少一个预注册 win：capacity ≤−15%、cost/success ≤−10%、或 overflow/latency 显著改善且质量非劣。

## Publication

- 100 cluster × 3 executor seeds 只够内部 Gate；
- 对外 publication 建议 ≥150 cluster、≥3 seeds、至少两个模型/Provider lane，并公开 immutable bundle。
