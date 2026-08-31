# Checkpoint v2.1 设计

## 模型可见最小内容

- exact active directives；
- current key/value + supersession；
- active/parked fronts；
- unresolved errors/validation；
- external side effects；
- next safe actions；
- 需要时可调用的短 evidence refs。

## Host details

- snapshotHash；
- full heads；
- source span；
- complete pointer manifest；
- verifier report；
- deterministic render hashes；
- schema/config/tokenizer revision。

## Verifier

```text
oracle/source span
→ directive exact/polarity/status/time
→ claim supersession
→ outcome attestation
→ pointer read + hash + cross-scope deny
→ tool-pair/retained-tail
→ two-run output hash
→ serialized payload token count
→ must-shrink/equal-budget
```

## Recursive rule

新 checkpoint 必须从 Store heads 重建；不得只解析上一 summary。上一 CompactionEntry 只用于 host lineage，不作为唯一事实源。
