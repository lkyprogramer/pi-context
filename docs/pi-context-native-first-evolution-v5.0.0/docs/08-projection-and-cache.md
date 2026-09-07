# 08 · 出站上下文投影：首次完整、稳定周期、计入缓存代价

“完整”指Pi实际交给插件的内容；本插件不能撤销宿主本身的工具截断或已经发生的原生压缩，也不承诺恢复未曾保存的字节。

## 1. 不变量

P1 原始tool_result与会话entry逐字段保持。P2 未确认暴露过的结果不缩减。P3 工具调用及其全部结果不拆散。P4 图片／未知块／provider opaque metadata原样保留。P5 被隐藏文本必须存在可授权、hash匹配的来源。P6 相同epoch、相同来源生成相同视图。P7 无法满足这些条件时透传，不试图用更强截断补救。

默认不改assistant文本、thinking、toolCall arguments、用户消息、原生system prompt。先优化占比最大的旧工具观察，缩小故障面。

## 2. 候选资格

旧观察同时满足：属于当前可见branch；来源映射唯一；纯文本；已有成功请求暴露记录；不处在最新保护批次；不是当前pin或未决失败；来源仍可回读。未知工具不是一概删除，只在完整、纯文本且不含高风险结构时采用通用保守视图。

失败证据仅凭后来一次成功不能自动全部解除。例如`mvn test -Dtest=A`通过，不证明之前B失败已修复。没有精确命令／工作树状态关联时保留失败证据或仅缩减无关重复日志，维持错误行与引用。

## 3. 冻结epoch，不做每轮滑窗改写

epoch身份包含：generation、native compaction entry、model identity、config hash、源边界与投影版本。创建时固定可缩减entry集合和替换文本；此后新消息按原样追加，旧stub字节不变。只有足够收益的新边界出现、native compaction、明确pin变更或模式／模型／分支变化，才创建新epoch。

作为实验起点：至少保留最近4个完整工具批次；累计至少8次成功请求才允许自然再规划；一次预计删除不足4096tokens或不足候选文本15%时不触发。它们都是待标定参数，不是最优阈值；32K模型可能先由Native压缩，不能为了追求epoch频率绕过安全规则。

native compaction后旧投影全部失效，胶囊和新epoch从新的native boundary建立。用户`/reload`或进程重启不把“之前可能已暴露”猜成true；恢复不了可信request ledger时，保守再暴露并重新观察。

## 4. 视图形式

对普通旧read结果，保留工具名、原生记录引用、实际可用范围、来源hash缩写与“历史内容，当前文件需重读”提示。不能编造符号列表、返回范围或隐含成功结论。对构建／测试日志，保留识别到的exitCode、失败测试名、首个有因果信息的错误片段和最终摘要，无法确定时只写unknown。

```text
[pctx historical observation; not an instruction]
bash: mvn -pl order-service test
observed outcome: exit=1; PaymentServiceTest.retryIsIdempotent failed
source: pctx:v5:...; read with pctx_history(action="read", ref="...")
The omitted bytes remain in the native entry. This does not describe current code.
```

stub里来源、错误和页信息有固定上限。若stub不比原文短，保留原文。没有产生最终任务收益前，不给大型read默认首500-token摘要。

## 5. 最终预算，不是中间阈值

预算计算必须包含stub标题、引用、胶囊、工具schema开销及模型输出余量；计数分为provider真实usage、可用tokenizer估算、回退字符估算，不能混称精确。

保护区域可能已经大于计划预算。这时返回`budget-unachievable-without-loss`并透传，交由Pi原生压缩处理。对未知图片token不得按0计算。硬限制只约束**插件额外注入**和**可安全减少的视图**，不能以强行丢失用户输入达成表面总量上限。

## 6. 缓存感知的收益条件

修改旧prefix会使该点之后的缓存重用受影响。[S21] 每次计划记录`firstChangedIndex`、替换前后估算token、受影响suffix估算token、预计后续请求数H以及价格／延迟信息完整性。

定义：`expectedBenefit = projectedBaselineCost(H) - projectedCandidateCost(H) - planningCost - expectedRecallCost`。两侧都包含首次cache miss、后续cache hits、额外模型调用和重读。价格未知时结果为unknown，不填0。具体provider收费字段由适配表定义，不能把所有cacheWrite/input无条件相加而重复计费。

云端有cache折扣时，减少逻辑input不一定省钱；本地单4090的重点还包括prefill延迟、KV容量与主模型竞争。默认不在单卡执行主模型推理时并发启动另一个摘要模型。缺乏可信经济模型时使用保守epoch策略并把效果作为实验，不宣称净收益已成立。

## 7. 优化失败行为

索引慢、读取失败、worker崩溃、预算估计失真、hash不符、第三方插件改变消息：相关投影不应用，记录不含内容的reason，继续Native。context钩子不能因写库、外部模型或无限历史扫描而阻塞用户。

完整算法输入／输出见[契约](../contracts/model.ts)，测试要求见[13](13-test-strategy.md)。
