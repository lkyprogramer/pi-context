# 04 · 外部调研：值得吸收的机制，不应照搬的系统

## 结论先行

本次资料并不支持“最复杂的层级记忆一定最好”。更稳妥的设计是：以简单、可回读的旧观察缩减作为强基线；围绕来源、生命周期、缓存和真实任务逐步增加复杂度。不同论文与插件解决的任务不同，不能把它们的数字直接相加成为pi-context的预期提升。

| 项目／研究 | 值得采用 | 不直接复制 | 证据边界 |
|---|---|---|---|
| Chat On Steroids [S12] | 历史外置可回读、交接冻结、同一任务可续 | Chrome自动化、另开会话、Goal/Worker引擎 | 面向ChatGPT浏览器，不是Pi插件实验 |
| pi-posthorse [S13] | 完整工具批次后切换；未被模型看过的结果必须保留 | fork专用context_window与自动rollover钩子 | 官方Pi不支持其必要扩展契约 |
| pi-post-compact [S14] | 首次可见与事后collapse分开；输出失败保留原文 | 修改assistant工具参数；随时滚动重写历史 | 作者明确提示prefix cache损失，未复测 |
| alpertarhan/pi-smart-compact [S15] | 来源验证、失败不提交、matching compact ACK | 默认搬入十阶段管线和图谱 | coverage分数不是任务正确率 |
| pai-acp [S16] | 明确的压缩／恢复路径、按需展开 | 让模型承担全部记忆调度 | 更多工具调用是否值得需计总账 |
| observational-memory插件 [S17] | 稳定观察区、异步生成 | 默认额外模型、默认跨窗口长期状态 | 未证明适配单4090与本用户Java任务 |
| pi-codex-goal修复 [S18] | Pi单一压缩调度拥有者 | turn_end里的独立ctx.compact循环 | 是已修复的历史案例 |
| Complexity Trap [S19–20] | observation masking必须作强对照 | 将SWE-agent结果当Pi参数最优值 | 模型、scaffold、任务与本项目不同 |
| Manus [S21] | 稳定prefix、恢复引用、全部成本意识 | 模型logit mask等provider专属能力 | 工程经验，不是插件独立评测 |
| Anthropic [S22] | 小而高信号的工作集、结构化笔记 | 以“少token”代替任务验收 | 通用设计原则 |
| Factory [S23] | 任务级成本与artifact/continuation probes | 单用LLM judge判最终质量 | 厂商实验需独立验证 |
| LCM [S24] | 原文是事实，摘要是派生视图 | 内嵌数据库服务＋摘要DAG＋强制子代理展开全套 | OOLONG聚合，不是Java代码修复 |
| Mastra [S25–26] | 稳定前缀、时间边界、pending工具保护 | 默认Observer/Reflector替换Native | LongMemEval记忆任务不等于coding |

## 1. 从Chat On Steroids真正学到什么

它最有价值的是把“交接期间继续修改机器”视为一致性风险，并使新上下文仍能访问历史。对Pi，应对应为：在原生安全边界形成checkpoint，带generation和source hash，提交失败不激活。Pi已有原生会话树，无需为这一原则再次创建一套主／子聊天或浏览器身份系统。

## 2. Posthorse不是本项目可直接套用的最佳实现

它公开声明依赖fork的原生window记录和专用自动压缩hook。因此它在那套宿主里可能是一种合理选择，但不满足本次“官方Pi插件”的约束。可借鉴的，是完整批次、当前用户输入和未消费工具结果的保留规则。不能把“fresh context, same journey”的比喻当成官方API存在的证据。

## 3. 确定性缩减应先赢，再谈语义升级

Complexity Trap对编码Agent的实验说明，简单策略能成为很强的效率基线。该研究并未证明所有旧结果都能安全删除，也未覆盖本用户Qwen部署、Pi插件组合与长时间Java改造。v5因此采用更保守的“已暴露＋分支一致＋可回读＋冻结epoch”，然后用真实任务确定保留窗口，不照抄论文窗口大小。

## 4. 外置历史与长期知识不是一回事

历史回读回答“当时工具返回了什么、哪条消息做过什么决定”；项目知识库回答“现在持续有效的规则是什么”。后者还需要有效期、冲突处理、人工确认与权限治理。v5默认只做前者及显式pin，不默认进行跨项目memory synthesis。

LCM提出的可恢复引用也不保证模型必然检索。模型不调用工具、检索词不对、读到旧状态、恢复后仍误用，都是端到端失败。它们必须由C2和真实任务覆盖，不能用存储层100%回读掩盖。

## 5. 社区体验怎么转成可验收工程问题

即使拿到原帖，“压缩后变笨”仍需要分解：关键事实消失、事实仍在但未被注意、事实已过期、cache重建慢、工具输出首次丢失、任务本身不确定。对应测试分别是pins/source probes、C2 recall、stale-state oracle、cache telemetry、first-exposure invariant和任务基线。

本次X原帖未核验、Reddit访问受限，不能据此陈述平台共识。相关故事只作为场景生成灵感，正式判断全部落回源码、公开契约和可运行验证。

全部来源链接与证据类型见[来源索引](../SOURCE-INDEX.md)。
