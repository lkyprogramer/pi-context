# 12项剩余问题登记

严重度定义：P0先于任何带工具Live修复；P1阻断balanced效果/安全结论；P2应在本轮一起收口但不扩架构。反例为隔离受控输入，不能倒推出真实run必然出现同样行为。

## F01 · P1 · 折叠规划误计已退出请求的历史

证据：E1+E2；探针 `P01-archived-plan`；任务 R02, R03。

**原因。** applyContext把SessionManager.getEntries()的全部原始历史交给planner；scope允许当前祖先，但Native compact已移出活动请求的祖先仍可通过refForField。planner先扣它们的估算长度并达到目标，recordFold发生在render之前。

**观察与边界。** 真实源码反例：规划r:0、savedTokensEstimate=19865、foldEvents=1；out.applied=0、context没有返回任何改动。不能将当前run的fold计数自动当作wire证据。

**修复。** 显式拆ArchiveBranch与ActiveView。候选必须唯一映射到本次event.messages的具体字段；render后实际applied>0才记一次fold，节省按最终前后内容计算。

源码：[src/plugin.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/plugin.ts) · [src/pi/source-reader.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/pi/source-reader.ts) · [src/projection/planner.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/projection/planner.ts)

## F02 · P1 · 暴露与批次关系穿越分支/压缩边界

证据：E1+E2；探针 `P02-sibling-exposure;P03-compaction-exposure;P08-duplicate-call-batch`；任务 R02, R03。

**原因。** exposedEntryIds仅按全文件顺序遇到任何成功assistant就清空pending。collectBatches对每个assistant重新扫描全文件结果，且相同callID在同批重复两次、一条结果也判complete。

**观察与边界。** 兄弟分支上的成功assistant将未消费r标记exposed；Native摘要后成功回复把已经隐藏的原文也标记exposed；双相同callID/单result为complete。并不等于所有正常多工具批次失败，正常多ID支持已进步。

**修复。** 批次只在当前可信branch构建，一次线性扫描拒绝重复/倒序/孤儿。暴露以当前进程内具体请求原文字段快照和成功assistant确认；无证据时保留原文，重启不凭全文历史猜测。

源码：[src/projection/exposed.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/projection/exposed.ts) · [src/projection/batches.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/projection/batches.ts) · [src/pi/adapter.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/pi/adapter.ts)

## F03 · P1 · 模型工具翻页仍不能形成完整往返

证据：E1+E2；探针 `P04-search-cursor-append;P05-read-cursor-target;P06-search-cursor-visible`；任务 R04。

**原因。** search cursor绑定瞬时leaf/branchHash，每次history工具往返都推进leaf；formatHistoryResult没有把nextCursor/cursor放进模型可见content；read只使用byteOffset不验证cursor.ref。

**观察与边界。** 第一页a，新增正常history call后第二页再次a；cursor虽在内部结果生成，模型content不含它；A字段cursor用于B字段仍返回B的中段并verified=true。单对象Hash已正确，这是生命周期而非Hash算法问题。

**修复。** 冻结有限搜索结果快照，anchor仍为当前祖先允许继续；兄弟分支/查询变化拒绝。nextCursor必须进入content。read游标同时绑定字段完整ref/hash与UTF8偏移。

源码：[src/history/search.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/history/search.ts) · [src/history/read.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/history/read.ts) · [src/commands.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/commands.ts)

## F04 · P2 · 索引配额在去重前检查，误报满且阻塞新记录

证据：E1+E2；探针 `P07-index-cap-duplicates`；任务 R05。

**原因。** upsertBranchSync在INSERT OR IGNORE之前先检查used+byteLen。新leaf时又从全部旧entries开始，已有大记录会吃掉一次虚构预算。

**观察与边界。** 配额150B，已有100B；新增6B本可写入，但再次检查旧100B后index-full，rows仍1，needle查不到。长会话同时反复扫描/计算旧Hash，性能风险需微基准定量而非凭空给百分比。

**修复。** 先按字段identity判断已有记录再计新增bytes；增量跟进新entry，branch重放也按id跳过。maxIndexBytes明确是原始索引文本逻辑预算，不声称等于SQLite/FTS物理文件上限。

源码：[src/history/index.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/history/index.ts) · [src/plugin.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/plugin.ts) · [src/history/scope.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/history/scope.ts)

## F05 · P2 · 身份状态和事件计量仍有不一致

证据：E1+E2；探针 `P09-profile-config-hash`；任务 R03, R07。

**原因。** setProfile改变config但不刷新configHash；model fingerprint只有model.id；message_end未限制assistant；session_compact在willRetry=true时直接返回。

**观察与边界。** profile切换后状态Hash与实际config重算不一致；源码路径可把user/tool消息计为请求，并漏记overflow成功compact。未独立声称该run发生了所有路径。

**修复。** profile/route变更统一fence；identity至少provider+model+配置；只按assistant终态记模型请求，摘要usage单列；所有成功原生compact（含overflow）清plan并计事件。

源码：[src/plugin.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/plugin.ts) · [src/pi/adapter.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/pi/adapter.ts)

## F06 · P1 · 缓存、输入、费用的语义混淆

证据：E1+E2；探针 `P10-cache-denominator`；任务 R07, R08。

**原因。** Pi OpenAI适配器将input设为promptTokens-cacheRead-cacheWrite。report却用cacheRead/input作命中率，并用input-cacheRead算未缓存。后者出现负值再标n/a，掩盖了分母本来错误。

**观察与边界。** 实际函数对input=100/cacheRead=60/cacheWrite=0算命中率0.6并通过两请求恢复；Pi分桶对应真实比例60/160=0.375。cacheRead>input并非天然异常，需核验安装适配器及原始usage。

**修复。** 定义Pi-disjoint和raw-inclusive两种来源归一化；Pi fresh=input，logical=input+cacheRead+cacheWrite，hit=cacheRead/logical。若私有服务不守协议或字段缺失记unknown，不能按“看起来合理”切公式。费用与物理prefill另外计。

源码：[eval/local/report.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/report.mjs) · [src/telemetry/usage.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/telemetry/usage.ts) · [src/pi/adapter.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/pi/adapter.ts)

## F07 · P1 · 试用Gate可通过大幅质量下降与无净收益

证据：E1+E2；探针 `P11-false-trial-gate`；任务 R08, R09。

**原因。** 每题只拒绝比Native少至少2次成功；每题2rep时少1次均被放行。H02 quotedVerbatim不是门；成本允许prefill最高1.5×；质量任务刻意不折叠。

**观察与边界。** 合成输入六题Native12/12、candidate6/12，H02引用全部失败、prefill增加40%，实际decide返回limited-balanced-trial。这不是对真实37次结果的重评分，而是说明Gate不足以支持该文案。

**修复。** 保留no-fold任务为干扰测试，不作为折叠质量证明。after-fold任务单列必达；关键状态/动作违规零容忍；任何候选新增失败不得自动授予试用。明确至少一种净改善证据，否则只history试用。

源码：[eval/local/report.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/report.mjs) · [eval/local/cases.json](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/cases.json) · [docs/pi-context-native-first-audit-v6.0.0/testing/scenarios.json](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/docs/pi-context-native-first-audit-v6.0.0/testing/scenarios.json)

## F08 · P1 · 重试被覆盖、完整成本和中位数不可依赖

证据：E1+E2；探针 `P12-request-median;P13-failed-attempt-accounting`；任务 R07, R08。

**原因。** loadEpisodes按case/arm/rep取最后记录，timeout/失败被后续成功覆盖，priorAttempts也只保留部分blocked/error；median偶数样本取上中位；摘要和失败调用成本未保证完整。

**观察与边界。** 1000token timeout再10token成功，报告只计10且prior为空；两条墙钟10和100的P50被算为100而不是55。

**修复。** episodeId与attemptId分开，所有planned episode进入分母；全部attempt成本累加，first-attempt和retry-policy结果分开；中位数对偶数取中间两数平均。

源码：[eval/local/report.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/report.mjs) · [eval/local/run-matrix.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/run-matrix.mjs) · [eval/local/run-episode.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/run-episode.mjs)

## F09 · P0 · Agent容器可读取真实API Key；H03回到宿主

证据：E2；探针 `static-only`；任务 R06。

**原因。** run-agent.sh将真实环境Key写入$AGENT/models.json，再把该目录挂载到Agent；网络为bridge；H03允许--no-sandbox在宿主运行。原grader已进入network-none容器，应保留其进步。

**观察与边界。** 这是明确的可达凭据路径，不是本次已经观测到密钥泄露。HOME重定向和read-only根不阻止读models.json或额外联网；不要把容器存在当作密钥隔离证明。

**修复。** 回用已有父进程Broker：Agent仅有短期受预算本地令牌；真实Key仅父进程内存。Agent无网络namespace，通过受限Unix socket/forwarder联系Broker；H03同沙箱运行；grader绝不挂Broker。

源码：[eval/local/sandbox/run-agent.sh](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/sandbox/run-agent.sh) · [eval/local/run-episode.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/run-episode.mjs) · [eval/local/grade.sh](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/grade.sh)

## F10 · P1 · 关键Live原始证据未随源码交付

证据：E2+E3；探针 `artifact-presence`；任务 R08, R10。

**原因。** 只有最新run的迭代记录与文案，附件/tracked tree没有20260909-112407完整manifest/episodes/requests/folds/results。run HEAD dirty并非自动无效，但入口Hash不能绑定全部导入源码与配置。

**观察与边界。** 不能独立确认37个episode分母、prefill比、H02失败过程和最终策略激活；本包不拿旧300组数据填空。

**修复。** 集中run生成一个小型脱敏可复算包：完整manifest、每attempt非敏感计量、oracle结果、fold实际应用receipt、file hashes；原始会话只本地保留私密，不为可复算要求公开思考或Key。

源码：[docs/iterations/native-first-v6.md](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/docs/iterations/native-first-v6.md) · [eval/local/report.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/report.mjs) · [eval/local/run-matrix.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/run-matrix.mjs)

## F11 · P2 · 旧CI矩阵未随单插件结构迁移

证据：E2；探针 `remote-ci`；任务 R01。

**原因。** 旧workflow仍运行test:unit/check:boundaries、旧tests/和packages/路径、旧Pi0.84.4选择脚本。

**观察与边界。** 当前required/compatibility红；但当前typecheck、frozen install、packed-install-hermetic绿色。unit日志明确是test:unit命令不存在，不是当前单测行为失败。

**修复。** 删除已失效任务，收敛成当前pnpm check与pnpm smoke两条；不要为了旧CI重建已移除的PCR包和12种强制门。

源码：[.github/workflows/required.yml](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/.github/workflows/required.yml) · [.github/workflows/compatibility.yml](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/.github/workflows/compatibility.yml) · [package.json](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/package.json)

## F12 · P2 · 将观测到的H02丢失直接归因为compaction并建议加层

证据：E2+E3；探针 `reported-not-rerun`；任务 R09, R10。

**原因。** candidates只要quotedVerbatim=false就命名post-compaction-evidence-delta，没有要求原生compact确实发生，也没有定位正文是否到达某次请求/是否回读/是否明确要求引用。

**观察与边界。** 项目自报observe丢1/2、balanced丢2/2值得保留；没有该run原始消息，无法区分折叠、Native摘要、检索、模型回答或oracle目标。

**修复。** 先生成boundary-local诊断：source→request→fold→compact→read→answer/环境断言。只有对照证明是哪一层才改策略，不因报告自动建议就增加动态注入和新状态层。

源码：[eval/local/report.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/report.mjs) · [eval/local/parse-session.mjs](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/parse-session.mjs) · [docs/iterations/native-first-v6.md](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/docs/iterations/native-first-v6.md)
