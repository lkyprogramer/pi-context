# 场景落地细则（R09）

`scenarios.json`是需实现的12项设计，不是已执行的benchmark。8个Q中每一项都是一个task cluster；两次重复只估计模型波动，不创造16个独立任务。C和G不进入质量成功率分母。

## 复用而非新建测试平台

从`eval/local/fixtures/L01..L06`复制实际工作区，重用当前grade.sh可信Oracle入口；新任务保存在`eval/local/review-fixtures/<id>`。最后TASK不得包含source事实值、KnownGood内容或明确修复方法。Q01/Q04/Q06/Q07/Q08另要求写出一个历史-only具体值，是为了验证任务确实依赖历史，不只是通用编码题。

Oracle在grader私有mount内，Agent看不到KnownGood/expected value/完整hidden test。可以保留公开单元测试帮助开发，但公开测试不得包含历史-only答案。generator将witness写入明确的原始toolResult或用户事件，sourceHash/entryId/blockIndex由生成后日志计算，不能写一个从未进入seed的期待值。

Q02/Q03需扩充隐藏Oracle到maxAttempts=7和grace=1730；模型侧代码不包含相同常量提示。旧源码缺陷本身保留，用初始工作区运行hidden Oracle必须失败；手工构造最小known-good必须通过。只有这两项本地验证通过才允许Provider花费。

## 历史形成与曝光

先由同一个受控脚本生成合法toolCall/result批次和需要读取的大文档，B0/B2初始seed完全相同。每个目标结果经真实Provider请求至少完整暴露一次；first-response不允许runner伪造usage当Live证据。若模型在可见assistant结论中合法记住目标，后续无需再次history也算成功，这是记忆保真而非工具使用考核。

通过固定seed长度和后续完整批次形成压力，保证目标退出最近4批。**先做校准、再冻结seed与预算**；正式run中不追加padding直到候选赢。B2若无法达到fold条件标unexercised并停止后续同类开销。w64k是诊断环境，production w262k另列后续可选，不能从前者宣称生产长窗口已验证。

Q05必须有一次官方Pi Native compact；原始错误不被PCR折叠，但它可能从Native active context消失。之后fold针对其他可折叠历史，quoted-error恢复是独立任务结果。若失败，定位原始error是否在summary、history命中是否正确、模型是否调用、答案是否满足精确引用；禁止仅凭失败就增加delta注入。

Q06 parent树明确一条当前分支和一条兄弟分支，SessionManager实际导航，不用工作区hint文件冒充。Q08实际结束/重启宿主；插件没有持久witness时重新原文暴露的代价计入episode，不以恢复内存Map蒙混。

## 数据发布

场景可包含合成nonce与源码，不能含真实凭据或用户历史。公开汇总只保留witness hash和expected匹配布尔；对合成数据可附完整source。真实个人轨迹未来加入时标adapted/private，先脱敏再拆分train/dev，不把本轮修失败的样本叫locked holdout。
