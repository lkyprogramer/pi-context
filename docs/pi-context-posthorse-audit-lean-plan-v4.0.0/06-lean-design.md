# 下一版最小目标设计

## 1. 不新建项目、不再拆更多包

保留当前packages目录和单个生产扩展，修现有实现。核心新模块集中在：`branch-access.ts`、`observation-envelope.ts`、`request-usage.ts`、`small-runner.ts`；小评测和安全测试所需辅助脚本见任务表，其他优先修改现有文件。具体文件归属以task index为准。依赖方向维持core/contracts纯逻辑，runtime组合，storage-node持久，pi-adapter映射。

```text
Pi 原始事件 ──> 认证/完整观察 ──> CAS + 来源事件索引
       │                              │
       ├─> 高信号可见工具结果          ├─> 当前分支祖先授权 ─> 有界回读
       │                              │
       └─> 最近完整tool-batch ──> 一个RuntimeSession ──> 请求视图
                                      │
                           可选checkpoint；Pi持久化与ACK
```

## 2. 稳定Owner，变化Fence

Owner仅按workspace/session注册；在RuntimeSession方法输入中传入当前BranchView以更新当前head，不创建新Owner。写队列按session排队；Branch切换、model变化使候选stale但不凭空让允许的祖先事件失效。FTS先定位候选，再用祖先集合筛选，或SQL显式join祖先表，必须在limit之前完成权限过滤，避免允许结果被不可见候选挤掉。

首次恢复可扫描当前branch建立索引；随后增量append；tree切换重建或走共同祖先路径。可用宿主getBranch作正确性底线，先保证不漏；性能优化验收用调用计数和数据规模曲线，不要求无证据的绝对O(1)。

## 3. 写入与可见结果分开

原始ObservationEnvelope是事实，Reducer view是派生文本。文本结果 <=500估算token时尽量完整保留；超出时保留退出/错误/改动/定位，另附一个短Evidence ID。该500初值与 T03 RED / `DEFAULT_OBSERVATION_VIEW_BUDGET_TOKENS` 对齐，并非真实tokenizer保证：最终视图必须用当前路由预算复核。一次返回中不得只有内部hash。

未知块采取透传bypass，不允许变空。存储失败不应默默宣称可恢复；对安全敏感的原文无法安全落盘或脱敏时明确终止相应工具结果消费。无敏感风险且未降噪的原文透传可以作为显式degraded模式，不能输出伪Blob句柄。

## 4. 请求只做必要工作

默认profile为ingress：原生compaction保持，context原样返回；只做安全工具降噪和注册受限history工具。experimental-runtime才进行状态注入/历史物化。实验身份不可再由 `PCR_EVAL_MATERIALIZER` 隐式成为产品默认。

Full runtime请求先保留最近不可拆原始批次，再去重派生补充。稳定指导不变；大hash、heads、租约精确deadline写receipt不常驻prompt。需要时只注入一个小而有用的片段；无需求不检索、不显示空directory/lease。

## 5. Checkpoint最低语义

不追求24token最小值。一个可用capsule至少说明当前目标、有效禁令、未完成/待验证事项、最近失败/下一安全动作、少量文件和可读Evidence引用。状态只取有证据的数据；字段未知就写unknown而非推断成功。

若只有一个禁止句，其他上下文有大量活跃动作，不能因“句子存在”就认为完整。遇无法有界保留的活动原子组，先做有证据的tool输出削减；仍不能容纳时安全停止或走Native fallback，不能删掉未消费结果。

## 6. 删除/延期的复杂度

本轮不做语义后台、向量检索、跨项目memory、完整事实图、在线学习策略、多层checkpoint树、Posthorse宿主换窗、不带真实收益的复杂lease续租策略。现Lease只保证当前页有界/到期，不把剩余次数和hash全文写进Prompt。

旧目录/schema不兼容可以显式新版本，但不能未经授权删除用户旧库。个人开发用全新临时测试库；生产旧库只读拒绝并给出明确备份/导出路径，不追加多轮兼容层。

## 7. 成功定义

先达到工具事实不丢、同分支原文可读、隔离无越权、动作序列不删。然后看真实任务的成功率、总请求tokens、总时长和恢复工具数是否改善。不是“生成更多表、跑更多测试、文档任务全done”。
