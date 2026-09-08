# pi-posthorse：借鉴机制，不复制宿主路线

固定研究提交 `836a23cca3a5fabe4222d59d95778e4da95f374d`。阅读README及index.ts的预算、提醒、自动handoff、未消费tool batch、notes与history代码。没有在本环境跑其完整宿主集成，也没有公平任务benchmark，不能按README推断它胜过Native/PCR。[S4–S7]

## 1. 它不是另一种摘要Prompt

Posthorse把“新上下文窗口”做成真正的宿主事件 `context_window`；旧对话离开活动窗口但保留在日志。它依赖作者的 `fitchmultz/pi` fork，使用 `ctx.newContext()`、`getCompactionSettings()`、`session_before_auto_compact` 等fork能力。README锁定的0.85.0/f9b06177…与PCR现有认证metadata补丁不是一回事。

核心职责划分：**Pi负责持久窗口边界，Posthorse负责何时提醒/换窗、短handoff、notes、history。** 工具请求的new_context在完整批次成功后才提交；兄弟工具失败不得提前换窗。自动路径在传统摘要调用之前接管，避免先付摘要成本。手动compact仍是另一条原生功能。

## 2. 最值得吸收的六点

| 机制 | 源码位置 | PCR处理 |
|---|---|---|
| 稳定指导而非每轮动态meter文本 | before_agent_start/buildGuidance | 将使用history/原文的短指导保持稳定；头部不注入时间/hash大清单 |
| 无提醒就不扫全历史 | context/turn_end fast path，约690–770行 | 先判断需要性；正常request只用增量branch index |
| 页大小取剩余预算 | requirePage/freshPayloadChars，约610–670行 | 已部分采用；保留工具输出/窗口双上限，修好UTF和header计价 |
| 原始证据优先于回读回声 | historyHit，约220–280行 | 当前skip三个PCR检索工具是正确方向，保留；混合消息中原始内容不能全被降权 |
| 未被模型消费的tool batch优先保留 | unconsumedToolBatch/buildAutoHandoff，约400–560行 | 直接成为T03/T04验收；不能用“可回读”替代首次观察 |
| 紧急handoff区分意图与进度 | buildAutoHandoff | 只保留有来源的目标/禁令/待验证结果，不把历史助手自述写成已完成 |

优先级不是再开发notes系统，而是让现有tool结果和当前工作状态完整到达模型。

## 3. 当前已借鉴的实际成果

读取/Recall分页、按容量缩页、UTF偏移、检索自身输出不再二次入观察、FTS相同查询缓存、认证分支状态恢复，均已有源码和新定向测试。本包不再重复安排“创建这些模块”。下一步只修运行链错误与边界，检验实际效果。

## 4. 不照搬的部分

**更换Pi fork：** 本轮不做。PCR已依赖较小认证补丁；再加入无摘要窗口会扩大宿主合并面，违背用户此前减少宿主侵入的方向。

**无摘要换窗当质量保证：** 省掉摘要调用的代价是模型需要自行写handoff/notes、识别遗忘并history读取。小模型可能不触发回读或误读状态；延迟转移到更多工具轮，并不天然无损。

**直接复用notes/history安全模型：** notes为明文文件，跨worktree共享；history包含thinking文本的处理，all:true可扫更多session。PCR的凭据保护、来源权限、默认不暴露hidden reasoning不应被降级。源码的词法路径检查不能当完整文件系统sandbox，符号链接边界需另验。

**字符除四当精确计量：** Posthorse也是启发式。PCR用预算保守边界和真实usage校准，不照抄具体20k字符就声称所有CJK/图片都精确。

**整个索引和工具集：** 现有SQLite/FTS/CAS已具备基础，避免同时再引入另一套notes搜索、会话目录、权限模型和恢复协议。

## 5. 三种路线裁决

A：继续现PCR但修最短运行链（推荐）；本轮风险和工作量最低，可直接验证已有投资。

B：Native+安全输出Reducer/可选读取（默认保守产品）；若完整物化仍无净值，可单独保留这一模式，不以“未完成全架构”判产品失败。

C：Posthorse fork原生换窗（延期）；只有A/B对真实长期任务仍有无法解决的窗口成本，并愿意维护宿主时，单独小实验比较。不能与当前修bug同时切换，使效果归因失去控制。

**借鉴其简洁控制面和首次观察保护，不是把两个项目所有功能相加。**
