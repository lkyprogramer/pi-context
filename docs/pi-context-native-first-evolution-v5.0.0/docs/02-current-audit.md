# 02 · 当前源码审计：已有成果、真实缺口与处置

## 1. 当前产品不是空白

仓库已有10个包，覆盖contracts/core/kernel/runtime/storage/storage-node/pi-adapter/worker/testkit/benchmark；核心源码约3.5万行。composition-root约1909行、extension约527行，小型基准运行器约1731行。规模本身不是错误，但多个“事实源＋生命周期＋对账”的组合提高了修改一次行为所需同时理解的范围。[S01、S04]

默认运行模式为ingress，正常context仍走原生，semantic默认关闭；不能把实验takeover的所有行为说成默认每个会话都发生。反过来，输入图片拒绝位于ingress hook，不能因为semantic关闭就认为图片路径安全。

已有值得保留的工作：来源和作用域校验、原文与投影的分离意图、分支授权在limit前、宿主确认后的提交意识、恢复与语义收益的分层评价，以及最新版报告对不确定结果的保守表述。v5应保留这些不变量，简化实现载体。

## 2. 宿主补丁依赖：P0产品边界，不是隐瞒

`pnpm-workspace.yaml`补丁表锁定`@earendil-works/pi-coding-agent@0.84.4`；补丁为输入增加独立ID、回执元数据及拒绝结果。`user-input-hook.ts`开头强制要求自定义导出；`tests/compat/pi-version-contract.test.ts`也以该契约为正确基线。[S02、S29]

因此现有packed验收最多证明“打包产物＋指定patched host”兼容，不能证明普通`pi install`适配官方宿主。v5不允许把类型断言、伪造常量、静默热补丁作为解决方案。改为读取宿主已经接纳并持久化的用户消息；对真正原始UI输入的强认证保证明确降级为不提供。

## 3. 实际探针结果

| 编号 | 本次观察 | 实现位置／范围 | 处置 |
|---|---|---|---|
| A01 | stock导出形状抛`PCR_PI_INGRESS_METADATA_CONTRACT_MISSING` | 模块加载，非真实loader | 删除整套patched ingress依赖 |
| A02 | 单图片在500预算时变成两个text块 | observation-envelope视图 | 图片保持原始块；不走文本压缩 |
| A03 | 500预算下20k字符结果仍估算5006tokens | 最终渲染未封顶 | 预算约束最终可删视图；安全内容超限交还宿主 |
| A04 | 4100字符后关键标记首次不可见 | read reducer首4000字符 | 首次暴露完整；以后按整个旧观察缩减 |
| A05 | 非循环共享对象误判cyclic | 全局WeakSet重复引用判断 | 使用递归栈检测，或明确只接收规范JSON树 |
| A06 | 未知块归bypass后仍被最终视图丢掉 | 非标准／未来扩展块 | 真正的全通道bypass，不重建已知小集合 |
| A07 | `bash {command:"mvn test"}`走bash而非test-log | reducer按toolName选择 | 结合工具输入判断；不依赖分类决定安全性 |
| A08 | 含图片input触发abort且不capture | 真实注册hook＋宿主stub | 不接管输入；图片路径原生透传 |

**这8项是组件级可复现观察，不是8项端到端用户故障统计。** A06属于未来／第三方边界；A07首先是选择器设计差异，尚未证明任务失败。A02–A04针对观察视图模块，是否影响某次会话取决于模式和调用链。原模块探针、源码哈希和作用范围见`evidence/audit-probes-result.json`。

## 4. 需要改变的安全与完整性定义

当前“原始”可能指已规范化封装，不必等于底层工具进程原始字节；“exact page”可能是呈现后的JSON文本而非图片原块。v5必须用四个术语分开：`native-entry-exact`、`text-range-exact`、`normalized-search-excerpt`、`current-file-content`。它们不可互相冒充。

当底层Pi工具本来就截断了bash/read结果，插件只能恢复宿主实际保存的部分；不知道的字节不能通过一个CAS地址宣称已经保存。原生`fullOutputPath`亦可能过期，应返回明确`source-unavailable`并要求当前状态核验。

`exitCode`缺失不等于0；旧测试的0也不等于当前代码通过；来自RPC的输入并不天然比interactive更不可信，二者都不是跨插件的身份认证。

## 5. 最新canary应该怎样读

仓库报告状态complete，仅表示该次计划完成了收集／汇总；其结论明确是inconclusive。24计划配对中16完整reader配对，8独立reader clusters；编码侧工具禁用是隔离门禁，而非真实代码任务成功。[S05]

| 指标 | 记录 | 正确解读 |
|---|---:|---|
| 产品hook恢复 | 5/5 | 有限样本证明C1协议路径 |
| 真实模型回读 | 0/1 | C2尚未建立，不推断整体0% |
| artifact覆盖 | 0/0、not-tested | 没测，不是零错误 |
| 成对任务输入中位变化 | +0.1078% | 此次未体现输入节省 |
| 成对wall-time中位变化 | +2.9164% | 不能用compact等待下降覆盖它 |
| compact等待变化 | −99.9014% | 局部指标，不是总效率 |
| monetaryCost | null | 无法声称省钱 |
| 成功差CI | [0,0]、8clusters | 全同结果的小样本bootstrap退化，不证明2%非劣 |

这比旧报告更诚实，应保留，不应把开发人员已修复的分母、未知价格、恢复等级问题重新写成当前缺陷。

## 6. 优先级和保留清单

P0：官方宿主正常加载、图片／未知内容不丢、任何优化异常不吞用户输入、分支数据不泄漏、工具批次和side effects不被重放。

P1：可查询历史、准确分页和源码hash、成功请求暴露跟踪、稳定epoch投影、原生压缩后的必要状态、真实C2恢复。

P2：缓存与真实任务收益、跨长会话恢复、语义摘要消融。默认不承担跨项目长期知识管理。

保留旧测试的**不变量与攻击样本**，不机械复制与旧包结构、PCR元数据、假宿主专属行为绑定的断言。旧实现只作对照和参考，不作为新公共API的隐性要求。

来源：[S01–S05、S29](../SOURCE-INDEX.md)。
