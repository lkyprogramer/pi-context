# 13 · 测试策略：先证明不破坏，再证明值得用

## 六层验证，不能相互冒充

| 层级 | 证明什么 | 不证明什么 |
|---|---|---|
| D0 文档／契约检查 | DAG、schema、来源、案例、脚本自身一致 | 插件实现完成 |
| D1 单元／性质测试 | 纯函数预算、分支、hash、batch不变量 | 真正Pi事件时序 |
| D2 官方宿主＋packed | 公开API、安装产物、事件／重启／卸载 | 模型会使用history |
| C1 协议恢复 | 来源hash、分页、授权、重建正确 | 任务需要时模型会回读 |
| C2 真实模型恢复 | 真实模型调用history并正确使用证据 | 所有编码任务不退化 |
| E2E Java闭环 | 修改、编译、测试、恢复、最终任务成本 | 超出样本范围的普遍最优 |

## 必须写成性质测试的不变量

**INV-01 Native identity**：observe/off下tool_result和context深度相等；balanced不修改传入对象。冻结输入后调用render，任何写入都应失败测试。

**INV-02 Exposure**：0次成功请求、只有HTTP200、流中断、abort、length停止，均不能使对应结果进入可缩减集合。

**INV-03 Multimodal**：text＋image＋未知对象随机排列和重复引用时，所有非文本块逐字段保留；普通共享对象不是循环，真正循环必须明确拒绝规范化但透传原始消息。

**INV-04 Batch closure**：多tool call、并发乱序、部分失败、toolResult缺失、重复ID，无法证明完整的batch不可缩减；保留assistant调用及其全部结果顺序。

**INV-05 Source exactness**：所有成功read页面重组与对应native text block UTF-8完全相同；emoji、中英文混合、CRLF、多字节边界、大单行均覆盖。

**INV-06 Authorization**：授权先于排序／limit／分页；100个高分跨分支命中不遮蔽唯一合法命中，也不能成为降级fallback数据。

**INV-07 Stable epoch**：未改变epoch的重复渲染字节一致；只追加新消息时已输出prefix不变。epoch主动变更必须有记录，不用新时间戳污染stub。

**INV-08 Final budgets**：最终输出包含标题／ref／胶囊的估算不能超过“可选注入预算”；保护原文超总预算应返回不可达而非损伤。

**INV-09 ACK**：只有匹配实际entry的proposal能commit，重复ACK幂等；failed/aborted/reload的旧proposal永不激活。

**INV-10 No replay**：插件的history／恢复／epoch更新不触发bash/edit/write。重试由宿主负责；插件不能复制side effects。

## 官方宿主集成矩阵

在固定官方0.85.1中运行TUI、RPC、JSON/print的最小流程；覆盖用户文本、图片、工具纯文本、图片工具结果、多个工具并发、手动compact、自动threshold、overflow retry、session_tree、fork、resume、reload、model_select、customentry重建。

用真实resource loader从**打包tarball**加载，不只从ts源码路径import。检测插件导出、schema、Node worker路径、无需patchedDependencies、无全局写入、无网络自动安装行为。卸载后从同一个native session继续，原文和摘要仍可读。

## 故障注入

对source read、SQLite transaction、cursor commit、projection freeze、native compact ACK、worker shutdown设置可控failpoints。每个failpoint至少覆盖throw、timeout、kill进程、generation改变四种扰动。注入钩子只编入测试版本，不暴露给模型，也不进入正式tarball。

属性测试初始seed固定并记录失败seed；每次CI固定1000组快速样本，夜间增加范围。数量只是执行参数，不能当统计置信水平。

## 性能门槛（预注册的工程目标，不是实测）

在明示硬件、会话尺寸和warm/cold区分的基准中：warm context增量处理p95目标≤10ms；100k条历史初次索引不得在context钩子同步执行；正常运行额外RSS目标≤128MiB；索引超容量时显式停止扩张并退化。cold首次构建单独报告，不能混进warm平均值隐藏尾延迟。

若目标无法满足，先降低扫描／缓存复杂度，不能删安全检查。云端请求延迟大不等于10ms以内就有实际收益；最后仍以E2E总耗时计。

## Gate命名

G0契约／包；G1零损伤；G2 C1恢复；G3 C2真实回读；G4真实Java闭环与统计；G5发布。所有gate有`passed/failed/incomplete/not-run`，n=0只能是not-run。协议fixture的oracle不会自动证明G3/G4。
