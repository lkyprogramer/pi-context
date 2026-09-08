# 社区研究：只组合能明确解释净收益的机制

本轮Exa执行4组搜索，围绕官方源码、已消费观察折叠、异步摘要、专用摘要模型；初筛约30条结果，再读取GitHub一手实现或维护者文档。搜索/README不等于统一benchmark。本节明确证据等级；未运行第三方项目、不采用自报压缩率作排名。[来源列表](../reference/SOURCES.md)

| 项目 | 本轮证据 | 机制、可借鉴点 | 代价和不采纳部分 |
|---|---|---|---|
| Middlewatch/context-fold 0.4.0 | 固定3bd8056；package/core apply源码 | 只替换内容、不删除消息；拒绝模糊ID；冻结fold对象；这比事后修复tool pair简单 | apply支持更广的assistant/thinking折叠；本项目只折叠纯文本toolResult，不复制更大权限面。最低peer范围不等于最新host实测 |
| psmfd/pi-context-manager | prune.ts实际源码blob95d0a… | 首次决定后冻结；保留toolCallId；head/tail且非文本保留；准确说明缓存稳定条件 | 首次就截断与本项目“先成功看全文”不同；不直接复制toolCallId-only键；重跑工具不等于读取当时原文；其宿主/共享组件依赖需另验 |
| fitchmultz/pi-posthorse | 最新6cdb50… README，前期核心源码已审，本轮不伪称重读全部 | 原生换窗、输入与已完成进度分离、未消费批次优先、原始命中高于检索回声、稀疏提醒 | 当前仍要求fitchmultz/pi fork，基线Pi0.85.0；不是官方Pi无补丁替代。跨会话扫描和thinking导出不符合本项目默认scope；新版增加UI卡片不等于质量改善 |
| alpertarhan/pi-smart-compact | 最新687f72… verify.ts及维护者架构 | 缺口是typed data；保留路径所有权；高风险成功声明需证据；先确定性修复 | 规则提取和LLM校验不是逻辑完备证明；多模型、多状态管道对个人项目过重；不能把正则occurrence当事实关系 |
| almogdepaz/pi-async-compaction | 本轮README，未固定当前codeSHA | 复用Pi summary，pending/ready/stale；后台减少前台等待；apply安全边界 | README明确某些情况下abort+continue，另自报基线Pi0.80.3；不是当前0.85.1已验证。重做stale work增加调用；只优化等待，不提升摘要保真 |
| JMHSV/pi-compaction-model | 本轮README检索，index.ts抓取未取得 | 仅选专用模型，仍调用Pi导出compact并保留cut/split/fileOps，最小正交优化 | 未实际运行；模型认证/价格/质量不同是实验变量；不把切换摘要模型计为本项目确定性算法提升 |
| pinion05/PI-CoACT | 本轮维护者页面检索 | 在已完成批次后建立短记忆/引用，源仍在原生日志 | LLM写摘要的额外成本、commit时机需核验；未深审实现，因此只作候选思路，不作安装结论 |
| jjuraszek/pi-context-prune / pi-condense | 本轮项目页面检索 | 小摘要、前沿推进和拒绝后防反复请求，启发失败防抖 | 更名和当前包映射需安装前核对；没有与本项目同模型基准 |
| Hypabolic/Hypa | 既有附件研究+本轮Exa背景结果，非最新代码逐行审计 | 在命令结果入口减噪，适合build/test日志 | 本分支现在刻意不改原生工具首次结果；不要未经消融又切回全量Ingress拦截；原始首次可见性与成本是显式取舍 |

## 结论不是“把九个项目合起来”

本项目最适合的组合只保留三块：**Pi native compaction + scoped exact history + once-exposed frozen observation projection**。pin胶囊默认关闭，待对应强需求及试验支持。没有必要再加跨会话图、自动语义Worker或修改官方内核。

对最终效果更重要的选择如下。

**A：原生+history**，实现和维护最小，历史回读增加schema成本，收益集中于长程精确事实。修复本轮读取漏洞后可作为可用底座。

**B：A+稀疏冻结投影（推荐受控试验）**，新结果至少在一次成功模型请求中出现；旧批次窗口内冻结，只有累计可观收益才重规划。不是完全无cache损失，而是把损失降为稀疏、可计量事件。

**C：替换摘要/异步/完整记忆系统**，当前不推荐。只有A/B表明主要失败发生在原生摘要质量或等待，并且并非回读/映射/测试缺陷，再做一个单独消融。允许C不代表它必须成为开发前置。

所有第三方性能声明都无法直接替代本项目同模型同工具的测试。尤其“原文能回读”不等于“模型会主动回读”，“内容更短”不等于“总请求更便宜”。

## 6.1 修订：选 B，但 B 的形状变了

上面的 **B** 在 6.1 中具体化为"阈值触发、一次折足、之后冻结"（[design/02-fold-algorithm](../design/02-fold-algorithm.md)），而不是 6.0.0 的"每 8 次成功请求重规划"。三条外部证据（[S24–S28](../reference/SOURCES.md)）与一条本地证据（[07-local-stack](07-local-stack.md)）同向：

| 来源 | 机制 | 对本包的映射 |
|---|---|---|
| JetBrains Complexity Trap（S24） | 遮罩旧观测、保留 assistant 推理与 tool call 参数，分数不降；LLM 摘要拉长轨迹 | 只替换 toolResult 文本；不动 assistant/user；不做第二层摘要 |
| Anthropic `clear_tool_uses`（S25） | `trigger` 阈值、`clear_at_least` 一次清足、`keep` 最近 N、排除特定工具/错误 | `fold.triggerPercent/targetPercent/protectRecentBatches`；isError 与非文本永不折叠 |
| Manus（S26） | KV 命中率第一；append-only；可恢复压缩 | 折叠一次后冻结；stub 字节稳定；`pctx_history` 回读 |
| 本地 4090（07） | 改旧消息 → 前缀作废，≈2000 tok/s 重 prefill；原生摘要要冷 prefill 整段 | trigger 60% 远低于 Pi 93.75%；收益定义为推迟原生压缩 |

**C** 中的 pin 胶囊与语义摘要在 6.1 删除（C01），原因不是"以后再做"，而是没有任何一手证据支持它们优于"原生结构化摘要 + 精确回读"，且它们引入了 F13 那类改 user 消息的正确性风险。若 E03 发现主要失败模式是"模型不主动回读 stub"，下一轮的候选是**更好的 stub 提示词与 `pctx_history` 描述**，仍不是摘要。
