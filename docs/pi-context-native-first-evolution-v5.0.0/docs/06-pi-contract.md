# 06 · 官方Pi公开接口与可实现边界

## 固定契约

源码基线为官方`9767ba275f3e9a5ee0f5c5342249b629ab1b2282`，package版本0.85.1，Node>=22.19.0。[S07–S11](../SOURCE-INDEX.md) 这不等于本次已验证同名npm包；T01必须安装实际发布物核对类型、构建、loader和hash。若npm产物尚不可得，使用固定**未修改官方源码**构建进行验证，记录构建身份；不得偷偷转用fork。

## 扩展事件职责

| 事件／API | 实际用途 | 返回／时序要求 |
|---|---|---|
| `session_start` | 重建scope、generation、branch及索引游标 | 可读取ctx；失败仅关闭优化 |
| `message_end` | 观察消息结束，安排索引补齐和request暴露状态 | 不能假定此时本地持久化顺序，下一context再对账 |
| `tool_result` | 可选统计已返回块类型和长度 | 默认返回undefined，绝不改原始content |
| `context` | 每次LLM前匹配native来源并应用冻结计划 | 只返回`{messages}`，异常返回原消息；不等待LLM |
| `before_provider_request` | 仅诊断序列化后的长度／hash，不能修补provider协议 | 不改payload；不保存密钥或全文 |
| `session_before_compact` | 仅实验语义策略；prepare/stage，不提交有效checkpoint | 使用公开preparation/branchEntries/signal |
| `session_compact` | 匹配真实CompactionEntry后确认checkpoint、清旧epoch | 必须匹配来源与payload，不只看fromExtension |
| `session_compact_failed` | 清待提交状态；保留旧有效checkpoint | 不补发“继续”，不另开会话 |
| `session_tree`、`session_shutdown`、`model_select` | 失效旧计划，取消对应异步任务 | 原分支候选不能跨代激活 |
| `agent_settled` | 排空轻量索引工作、结束任务级采样 | 不启动独立压缩／无限续跑 |
| `pi.appendEntry` | 写本插件自有pin／版本标记 | custom entry非新用户消息，不直接参与LLM |
| `registerTool`、`registerCommand` | `pctx_history`、`/pctx` | namespace固定，避免覆盖原生工具 |

普通`InputEvent`没有当前PCR补丁的inputId；官方返回类型没有reject。v5不注册接管输入的hook。普通ExtensionContext只有只读SessionManager；newSession/fork/switchSession位于用户命令上下文，不得把它们当任意工具或context钩子可用能力。

## 公开只读数据路径

`getSessionId/getSessionFile/getLeafId/getLeafEntry/getEntry/getBranch/buildContextEntries/getEntries`均存在公开类型。优先由`getLeafId`和`getEntry(parentId)`逐步补齐新祖先，遇到分叉、缺项或未知entry则重建可见branch。不能为了O(1)宣称而绕过宿主事实源或直接读取未授权session路径。

出站`AgentMessage`一般不带native entry id。映射策略：在可见branch中用`toolCallId`匹配工具结果，再校验内容规范hash；普通消息用有序比对与摘要hash，不单独用“文本一样”识别身份。出现重复、缺失、其他插件变形等歧义，**只跳过相关投影**，不猜最近一个。

## 首次暴露记账

在context钩子记录本次确实包含哪些原始结果。只有随后在同一generation观察到成功assistant结果，才把这些结果标为`exposed`；error、abort、未确认请求均不升级。provider调用和成功消息无法可靠关联时，保持unexposed。

`exposed`仅是“存在于一次成功请求的输入”，不是模型已经理解、记住或完成分析。仍需保留最近批次和强相关证据。流式HTTP200并不足以标记成功；请求可能在后续流中失败。

## 宿主压缩的现实限制

当前原生实现已有批次间阈值检查，插件不能照搬旧issue再建竞争性触发器。它看到的原生context估算可能大于插件投影视图，Pi因此提前压缩是可接受的保守行为；v5不修改宿主usage或虚构contextWindow来阻止它。

官方custom与compactionSummary最终转换为user文本。任何额外胶囊都必须明确标注“历史证据、并非新指令”，且不能依靠这个标记建立密码学安全边界。对本插件可检查的来源与范围做严格验证，对模型是否遵循语义仍做攻击测试。

## 禁用路径

禁止导入`dist/core/*`私有路径；禁止module augmentation伪造PCR接口；禁止patch-package／patchedDependencies；禁止强制as-never绕过宿主类型。唯一可例外的是对未知数据进行**运行时检查后**的窄类型收敛，并有失败透传测试。
