# 证据索引

- 审计仓库：`lkyprogramer/pi-context`
- 固定 HEAD：`9a2084d8667fc459aa14c3bd6c486228f15a6bf6`
- Tree：`1ddd4847c1dda59485dcabeb1f3cdeb38e3176c7`
- Live 对照快照提交：`36ce3126cfe2e332c563c64b88004696e4356d11`
- 当前 CI Run：`33372538099`

| ID | 路径 | 用途 | 固定链接 |
| --- | --- | --- | --- |
| S01 | `HANDOFF.md` | 当前完成声明、未运行范围、live keep-native 结论 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/HANDOFF.md |
| S02 | `apps/pi-context-runtime/src/extension.ts` | 默认公开 Extension 的真实产品接线 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/apps/pi-context-runtime/src/extension.ts |
| S03 | `apps/pi-context-runtime/src/composition-root.ts` | 生产身份、SQLite/CAS/FTS、user/tool ingress 资源工厂 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/apps/pi-context-runtime/src/composition-root.ts |
| S04 | `packages/core/src/budget/pricer.ts` | 消息 Token 计价与有效输入预算 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/core/src/budget/pricer.ts |
| S05 | `packages/pi-adapter/src/message-codec.ts` | Pi 消息 Envelope 编解码 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/pi-adapter/src/message-codec.ts |
| S06 | `packages/core/src/materialization/materializer.ts` | 四区 Materializer | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/core/src/materialization/materializer.ts |
| S07 | `packages/runtime/src/compaction/snapshot.ts` | Compaction Snapshot Assembler | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/runtime/src/compaction/snapshot.ts |
| S08 | `packages/runtime/src/compaction-service.ts` | Checkpoint 编译与 Pi CompactionResult | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/runtime/src/compaction-service.ts |
| S09 | `packages/core/src/compaction/checkpoint.ts` | Checkpoint renderer/verifier | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/core/src/compaction/checkpoint.ts |
| S10 | `packages/core/src/directives/temporal.ts` | Temporal correction 解析与 supersession | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/core/src/directives/temporal.ts |
| S11 | `tests/live-gate/paired-w2-live.ts` | 当前真实 Pi B0/B1 runner、评分与效率计算 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/tests/live-gate/paired-w2-live.ts |
| S12 | `tests/w2-gate/corpus.ts` | 5 族合成语料 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/tests/w2-gate/corpus.ts |
| S13 | `tests/live-gate/w1-session-jsonl.ts` | 冻结 JSONL、2K keepRecent、manual compact、probe | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/tests/live-gate/w1-session-jsonl.ts |
| S14 | `artifacts/runs/pcr-vs-pi-native/EFFECT.md` | 效果摘要 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/artifacts/runs/pcr-vs-pi-native/EFFECT.md |
| S15 | `artifacts/runs/pcr-vs-pi-native/COMPARISON.md` | Gate 边界与禁止结论 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/artifacts/runs/pcr-vs-pi-native/COMPARISON.md |
| S16 | `artifacts/runs/pcr-vs-pi-native/w2-live-spec-smoke/report.json` | 30 对原始 live 报告 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/artifacts/runs/pcr-vs-pi-native/w2-live-spec-smoke/report.json |
| S17 | `packages/benchmark/src/arms/w2.ts` | 新 B0/B1/B2 抽象 runner | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/benchmark/src/arms/w2.ts |
| S18 | `tests/live/w2-paired.test.ts` | 所谓 live B0/B1/B2 的实际测试实现 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/tests/live/w2-paired.test.ts |
| S19 | `packages/benchmark/src/reader/ceiling.ts` | Full-context ceiling 当前实现 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/benchmark/src/reader/ceiling.ts |
| S20 | `packages/benchmark/src/continuation/runner.ts` | 环境断言 runner | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/benchmark/src/continuation/runner.ts |
| S21 | `tests/live/closed-loop.test.ts` | 当前闭环测试的固定 Executor | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/tests/live/closed-loop.test.ts |
| S22 | `packages/benchmark/src/scoring/integrity.ts` | 真实 CAS/tool-pair/hash integrity scorer | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/benchmark/src/scoring/integrity.ts |
| S23 | `packages/benchmark/src/statistics/cluster.ts` | Cluster bootstrap 与 McNemar | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/benchmark/src/statistics/cluster.ts |
| S24 | `packages/benchmark/src/report/engine.ts` | 新 Gate Engine | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/packages/benchmark/src/report/engine.ts |
| S25 | `.github/workflows/compatibility.yml` | 当前远端 CI 矩阵 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/.github/workflows/compatibility.yml |
| S26 | `tests/acceptance/deterministic-mvp.test.ts` | 硬编码 scratch path 的验收测试 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/tests/acceptance/deterministic-mvp.test.ts |
| S27 | `scripts/pack-smoke.mjs` | 打包、clean install、models.json 依赖 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/scripts/pack-smoke.mjs |
| S28 | `apps/pi-context-runtime/package.json` | 发布元数据与 Pi host contract | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/apps/pi-context-runtime/package.json |
| S29 | `apps/pi-context-runtime/dist/extension.js` | 仓库内 dist 入口仍重导出 TS | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/apps/pi-context-runtime/dist/extension.js |
| S30 | `artifacts/runs/pcr-vs-pi-native/product/gate-mvp.json` | Deterministic MVP Gate 自身承认 task quality 未非劣 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/artifacts/runs/pcr-vs-pi-native/product/gate-mvp.json |
| S31 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/12-target-architecture.md` | 唯一 RuntimeSession 目标架构 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/12-target-architecture.md |
| S32 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/14-runtime-data-flows.md` | 目标纵向数据流 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/14-runtime-data-flows.md |
| S33 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/18-materialization-and-cache.md` | 真实 block 计价与 Cache Receipt 要求 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/18-materialization-and-cache.md |
| S34 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/19-checkpoint-and-compaction.md` | Checkpoint v2 完整内容与 verifier | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/19-checkpoint-and-compaction.md |
| S35 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/22-evaluation-v2.md` | A0/A1/A2、B0/B1/B2/F0 目标实验 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/22-evaluation-v2.md |
| S36 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/23-statistics-and-gates.md` | Cluster、Hard/Quality/Efficiency Gate | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/23-statistics-and-gates.md |
| S37 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/24-live-benchmark-runbook.md` | Natural threshold/overflow/recursive lanes | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/24-live-benchmark-runbook.md |
| S38 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/25-ci-build-and-release.md` | Required CI 与发布包要求 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/25-ci-build-and-release.md |
| S39 | `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/30-final-acceptance.md` | 最终 deterministic MVP 验收合同 | https://github.com/lkyprogramer/pi-context/blob/9a2084d8667fc459aa14c3bd6c486228f15a6bf6/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/30-final-acceptance.md |
| S40 | `GitHub Actions run 33372538099 artifacts` | 当前 HEAD Ubuntu/macOS Unit Test 失败日志 | https://github.com/lkyprogramer/pi-context/actions/runs/33372538099 |

## 证据使用规则

1. **代码事实**只由固定 HEAD 源码支持。
2. **实验事实**只由同一 run 的 report、manifest、raw response 与环境日志支持。
3. **文档要求**不能反向证明实现已完成。
4. Task/Finding 标记 `closed` 只表示仓库控制器状态；若当前 CI 或最终验收不满足，审计状态仍可重新判为 `open`。
5. 本包对 30 对 live 数据的重新评分只依据已提交 `probePreview`；没有重新调用模型，因此不冒充新实验。
