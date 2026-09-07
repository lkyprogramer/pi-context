# 来源与证据分级

固定审计日：2026-09-06。动态README只代表本次读到的内容；用户源码和Pi源码固定commit。代码/文档结论、仓库报告、此次探针和设计建议不得互相替代。

## S01 · 附件与 pi-context 最新 Git tree

类型：`code`。

[原始来源](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/pnpm-workspace.yaml)

附件 SHA256、完整 Git tree 复算与远端 commit/tree 对齐，详见 evidence/source-identity.json。

## S02 · 当前宿主补丁依赖

类型：`code`。

[原始来源](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/pi-adapter/src/user-input-hook.ts)

开头硬检查 PCR_INGRESS_METADATA_CONTRACT；InputEvent.inputId、input_result、reject、ingressMetadata 均来自仓库宿主补丁。

## S03 · 当前观察投影视图

类型：`code`。

[原始来源](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/runtime/src/observation-envelope.ts)

500 是估算阈值而非最终输出硬上限；图片与未知块组合问题已由原模块探针复现。

## S04 · 当前生产组合与 reducers

类型：`code`。

[原始来源](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/apps/pi-context-runtime/src/composition-root.ts)

ingest→reduce→admit→renderObservationView 生产链路；read reducer 固定取前4000字符；bash 按工具名称匹配。

## S05 · 当前小型真实 canary

类型：`retained-report`。

[原始来源](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/artifacts/lean-v4/report.json)

仓库记录：16完整reader pairs / 24计划pairs，8独立reader clusters；隔离未证明，coding被阻断，C2失败；不作性能胜出结论。

## S06 · 历史 lean-v4 设计

类型：`design`。

[原始来源](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/docs/pi-context-posthorse-audit-lean-plan-v4.0.0/06-lean-design.md)

稳定owner、变化fence、权限前置、默认native、延期复杂度；本方案保留这些方向，改变对patched ingress及首次可见压缩的选择。

## S07 · Pi 0.85.1 公开扩展类型

类型：`official-code`。

[原始来源](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/extensions/types.ts)

核对 context、tool_result、session_compact_failed、agent_settled、只读SessionManager；普通InputEvent无PCR元数据。

## S08 · Pi 原生压缩实现说明

类型：`official-doc`。

[原始来源](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/docs/compaction.md)

原始记录保留在append-only会话；默认reserve16384/keepRecent20000；当前已检查批次间阈值；一次性摘要请求缓存策略。

## S09 · Pi 会话与消息类型

类型：`official-code`。

[原始来源](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/session-manager.ts)

只读宿主API含getLeafId/getEntry/getBranch/buildContextEntries；原生entry id/parentId是分支来源基准。

## S10 · Pi 自定义消息转 provider 消息

类型：`official-code`。

[原始来源](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/messages.ts)

custom与compactionSummary最终都转user文本，不能把扩展注入当成高优先级指令或真实用户认证。

## S11 · Pi 固定源码版本与Node要求

类型：`official-code`。

[原始来源](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/package.json)

固定源码package.version=0.85.1，Node>=22.19.0；源码版本已核实，npm发布包一致性留给T01契约验收，不伪称本地装验通过。

## S12 · Chat On Steroids

类型：`project-doc`。

[原始来源](https://github.com/totec448-spec/chat-on-steroids/blob/main/README.md)

借鉴durable history、handoff fence与一次性交接；Chrome会话自动化、Goal/Loop、Worker不是Pi上下文插件的职责。

## S13 · pi-posthorse

类型：`project-doc`。

[原始来源](https://github.com/fitchmultz/pi-posthorse/blob/main/README.md)

README明确要求fitchmultz/pi fork与context_window等补丁；借鉴完整工具批次边界，不能复制为官方Pi即装即用实现。

## S14 · pi-post-compact

类型：`project-doc`。

[原始来源](https://github.com/comtihon/pi-post-compact/blob/main/README.md)

区分首次可见前摘要与看过后的collapse；承认缓存失效；其工具参数改写和无脑hard ceiling不照搬。

## S15 · verification-oriented pi-smart-compact

类型：`project-doc`。

[原始来源](https://github.com/alpertarhan/pi-smart-compact/blob/main/ARCHITECTURE.md)

Extract/Explore/Synthesize/Verify、matching session_compact后提交、FTS分支来源；verification coverage不等于真实任务成功率。

## S16 · pai-acp

类型：`project-doc`。

[原始来源](https://github.com/ranxianglei/pai-acp)

模型主动压缩/恢复/搜索是一条替代路径；工具调用负担及替换native控制路径须独立验证。未复跑其基准。

## S17 · Pi observational-memory extension

类型：`project-doc`。

[原始来源](https://github.com/nik1t7n/pi-observational-memory-extension)

Observer/Reflector值得作为后续可选实验；额外模型调用、激活时序、隐私与缓存账单不能忽略。

## S18 · Pi goal/compaction race 实例

类型：`issue`。

[原始来源](https://github.com/fitchmultz/pi-codex-goal/issues/46)

历史并发压缩竞争实例；后续修复取消自建主动压缩。只用作单一调度拥有者的经验，不称现存官方缺陷。

## S19 · The Complexity Trap

类型：`paper`。

[原始来源](https://arxiv.org/abs/2508.21433)

SWE-agent/SWE-bench实验支持把observation masking纳入强基线；不能将其收益直接外推到本用户模型/Pi/Java。

## S20 · The Complexity Trap 可复现实现

类型：`research-code`。

[原始来源](https://github.com/JetBrains-Research/the-complexity-trap)

提供策略与配置、数据；本次未下载/复跑其全套基准。

## S21 · Manus Context Engineering

类型：`engineering`。

[原始来源](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

稳定prefix、可恢复外部状态的工程经验；其Mask Don’t Remove主要谈工具选择，不与历史observation masking混为一谈。

## S22 · Anthropic Effective Context Engineering

类型：`engineering`。

[原始来源](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

高信号最小上下文、结构化笔记、适度压缩的设计原则；不是本插件的独立效果证明。

## S23 · Factory Evaluating Compression

类型：`vendor-evaluation`。

[原始来源](https://factory.ai/news/evaluating-compression)

强调每任务总成本、artifact/continuation/decision probes；厂商自评与LLM judge有偏差，需真实闭环及外部oracle补齐。

## S24 · LCM 论文

类型：`paper`。

[原始来源](https://arxiv.org/html/2605.04050v1)

原始存储与摘要视图分离；作者明确可检索不保证Agent必定检索。OOLONG聚合实验不等价于Java开发效果。

## S25 · Mastra Observational Memory 研究

类型：`vendor-evaluation`。

[原始来源](https://mastra.ai/research/observational-memory)

稳定观察前缀与异步Observer/Reflector；LongMemEval是跨会话记忆任务，不是coding正确性基准。

## S26 · Mastra 后续可靠性修正

类型：`engineering`。

[原始来源](https://mastra.ai/blog/changelog-2026-03-17)

按时间恢复观察、稳定分块、pending工具保护说明激活边界与可重放证据的重要性。

## S27 · Pi agent_settled 讨论

类型：`issue`。

[原始来源](https://github.com/earendil-works/pi/issues/2110)

区分agent_end与完全settled；当前是否可用以S07类型为准，不照搬旧issue缺陷。

## S28 · Pi compaction failure 事件讨论

类型：`issue`。

[原始来源](https://github.com/earendil-works/pi/issues/8175)

历史事件缺口已在当前类型出现对应session_compact_failed；不再次列为当前缺陷。

## S29 · 当前兼容和安装说明

类型：`project-doc`。

[原始来源](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/docs/COMPATIBILITY.md)

项目已如实声明stock Pi unsupported；本次是改变设计取舍，不指责其隐瞒。
