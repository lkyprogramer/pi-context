# 10 · 生命周期、并发与恢复状态机

核心balanced只需要generation、native compaction确认和胶囊来源fence。下文semantic staging状态机属于T17/T18可选层，不要求提前引入核心运行时。

## 一个generation令牌贯穿派生工作

`generation`在session切换、fork/tree跳转、model切换、reload、模式变更时递增。普通追加消息不递增，但source revision推进。每个索引批、projection proposal和semantic proposal都携带generation和source revision。返回时先比对再生效。

```text
INIT -> OBSERVING -> READY
             |         |
             |      PLAN_FROZEN -> RAW_APPEND -> next epoch
             |         |
             +------ DEGRADED -> rebuild -> OBSERVING

semantic only:
IDLE -> PREPARING -> STAGED -> HOST_ACK -> COMMITTED
                    |             |
                 ABORT/FAIL     SOURCE_CHANGED
                    +------> DISCARDED
```

状态是插件派生状态，不接管Pi agent loop。不会因为索引未READY而拒绝正常用户输入。

## 批次与请求

native一次assistant可以调用多个工具。所有调用结果齐备后才构成完整batch；并发工具的完成先后不改变batch来源集合。任何缺失、error或中断均保守保留，不把“最后收到的一个结果”当成整个batch成功。

context提交只登记“候选暴露”；同代成功assistant结束才能确认。HTTP错误、stream断裂、length/aborted/error是否可视为成功必须按宿主stopReason验证；默认只接受正常stop/toolUse且来源关联无歧义的完整结果。长度停止不得因有部分文字就升级全部历史为可删。

## 故障矩阵

| 故障注入点 | 必须观察到 | 禁止出现 |
|---|---|---|
| source读取之前权限变化 | 回读拒绝；context透传 | 未授权片段进入结果 |
| 索引事务中途kill | 重启可重建；cursor未越过事务 | 游标前进而证据不存在 |
| SQLite locked／corrupt | 受限退化；用户对话继续 | 无界重试卡context |
| 计划生成后换分支 | stale plan丢弃 | siblings内容混入 |
| 首次请求stream失败 | 原观察仍unexposed | 下一请求只剩stub |
| native压缩成功、ACK前kill | 从native entry恢复一次已应用状态 | 再压缩／再执行side effect |
| semantic超时／取消 | 费用留账；旧checkpoint保留 | 标记成功、注入半成品 |
| 其他扩展先改content | 映射不符时放弃相关变换 | 按近似文本错误绑定来源 |
| 未知content／图片 | 原样经过 | 丢块、把图片当空文本 |
| 暴露账本损坏／不存在 | 重新保守暴露 | 推断所有旧结果已看过 |
| 用户删除原生session | refs失效、禁止exact回读 | 从过期索引伪造原始历史 |
| 并发进程同一项目 | 不串会话、不泄露branch | 用全局lastWriter覆盖scope |

## 退化要可理解

`/pctx status`显示profile、当前generation、source coverage、index state、上次绕过reason、待提交proposal数和真实验证等级。不显示密钥、全文或未经确认的成本收益。status里的“健康”指组件状态，不是任务一定成功。

## 胶囊与pin的恢复

native custom pin entries是pin事实源；SQLite仅索引。启动读取可见祖先重建pins；同一个unpin只作用于其祖先中已存在pin。重新绑定到不同session不自动继承全项目pins。用户希望共享规则应使用其已有项目AGENTS.md，而不是隐形跨会话注入。
