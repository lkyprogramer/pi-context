# 发布门

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 Alpha、Deterministic MVP、Semantic Beta 和 Stable 的不可豁免证据。

## 2. 已冻结决策

- 每个门必须由 fresh command output 证明。
- Critical/High 安全失败不可 waiver。
- 兼容窗口必须有 packed Pi E2E。
- 缓存与成本按 successful task 评估。

## 3. Gates

### Alpha

- Pi Hook contract/owner/capability probe；
- SQLite/CAS/Saga/recovery；
- raw user/tool capture；
- no private imports；
- packaged install smoke。

### Deterministic MVP

- directive/evidence/continuity/materializer；
- exact/FTS recall；
- Pi host compaction takeover；
- hard directive recall 100%；
- tool pair violation 0；
- crash replay 100%；
- best simple baseline non-inferior；
- eligible prefix reuse median initial target ≥ 0.60（按 provider calibration review）。

### Semantic Beta

- semantic proposal/verifier/background；
- unsupported high-risk claim 0；
- stale candidate never applied；
- boundary-local continuation non-inferior；
- realized net value positive。

### Stable

- supported Pi matrix blocking green；
- security corpus/fuzz/mutation green；
- operations/recovery/backup/restore drill；
- 30-day canary evidence；
- docs/package/source manifest verified。

## 4. 不变量

1. 门槛变更必须有 ADR 与历史保留。
2. 任何“预计通过”不能标记为 passed。

## 5. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 6. 关联资料

- `checklists/release.md`
- `tasks/T45-deterministic-mvp-gate.md`
