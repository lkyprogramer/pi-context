# 固定来源与证据索引

审计日期2026-09-06。GitHub一手源码/项目报告优先；没有把此前调研中未复核的论文性能或“无损”声明当作本次事实。所有数字均可区分项目自报与本次离线复算。

| ID | 来源 | 作用 |
|---|---|---|
| S1 | https://github.com/lkyprogramer/pi-context/tree/bb7aea1b88f6645fb8e4f0b930a4087630e7a679 | 当前唯一代码与文档基线；ZIP重建tree一致 |
| S2 | https://github.com/lkyprogramer/pi-context/blob/bb7aea1b88f6645fb8e4f0b930a4087630e7a679/docs/reports/2026-09-06-posthorse-300-gate.md | 最新报告解释、凭据披露、来源范围和未完成事项 |
| S3 | https://github.com/lkyprogramer/pi-context/actions/runs/34006207051 | 当前Required状态与unit/packed/typecheck区分 |
| S3b | https://github.com/lkyprogramer/pi-context/actions/runs/34006207149 | Compatibility各cell当前编译通过但unit失败；后续检查跳过 |
| S4 | https://github.com/fitchmultz/pi-posthorse/blob/836a23cca3a5fabe4222d59d95778e4da95f374d/README.md | 宿主fork、角色分工与使用边界 |
| S5 | https://github.com/fitchmultz/pi-posthorse/blob/836a23cca3a5fabe4222d59d95778e4da95f374d/index.ts#L400-L610 | 未消费工具批次与有界handoff |
| S6 | https://github.com/fitchmultz/pi-posthorse/blob/836a23cca3a5fabe4222d59d95778e4da95f374d/index.ts#L610-L820 | 预算、提醒fast path、原生窗口hook |
| S7 | https://github.com/fitchmultz/pi-posthorse/blob/836a23cca3a5fabe4222d59d95778e4da95f374d/index.ts#L830-L925 | 明文notes/路径与分页设计；不当作sandbox |
| S8 | https://github.com/lkyprogramer/pi-context/blob/bb7aea1b88f6645fb8e4f0b930a4087630e7a679/packages/benchmark/src/scoring/probe.ts | 新scorer的summary字词误判与leading polarity边界 |
| S9 | https://github.com/lkyprogramer/pi-context/blob/bb7aea1b88f6645fb8e4f0b930a4087630e7a679/packages/runtime/src/observation-service.ts | raw text-only与pointer可见结果 |
| S10 | https://github.com/lkyprogramer/pi-context/blob/bb7aea1b88f6645fb8e4f0b930a4087630e7a679/apps/pi-context-runtime/src/composition-root.ts#L655-L683 | Reducer输出未回接visibleContent |
| S11 | https://github.com/lkyprogramer/pi-context/blob/bb7aea1b88f6645fb8e4f0b930a4087630e7a679/packages/core/src/materialization/dedup.ts | 内容去重与活动事件丢失 |
| S12 | https://github.com/lkyprogramer/pi-context/blob/bb7aea1b88f6645fb8e4f0b930a4087630e7a679/packages/storage-node/src/fts-index.ts#L157-L205 | 精确cursor访问与查询缓存失效机制 |

上次规格来源为用户已下载的v3重打包ZIP；其SHA256在BUILD-INFO列明。该ZIP内Task通用模板并不足以证明可自主实现；本包明确给出新数据链反例与边界。原规范关于管理员保护、100×3和完整产品发布条件已按个人项目目标收敛。

证据局限：没有本地完整Pi/Vitest复跑，没有目标Provider新增调用，没有Posthorse fork安装测试，没有重新扫描原私密DB。上游代码不同版本的cache语义不能替代目标服务实测；本次仅要求用量来源明确，不把某一种Provider计费等同所有实现。
