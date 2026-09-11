# 失败矩阵和可观测性

|情况|运行时动作|报告|
|---|---|---|
|找不到唯一ActiveView字段|原文透传，不新建替换|unmapped，不计saving|
|重复toolCall ID、未配对、兄弟分支干扰|保护对应批次|integrity diagnostic，不声称坏对话由插件修好|
|Provider失败/取消/只见summary|不确认原始字段暴露|attempt failed/aborted，usage缺失null|
|配置/模型/branch变化|单调epoch+1，清pending/不兼容plan|fenceReason，完整route key|
|render有候选但实际改动0|不发布新fold，不累计saving|candidateRejected=not-in-active-view|
|索引满/损坏|search degraded；read仍查原始session|数据能力退化与empty分开|
|续页scope/query变化|stale-cursor，不自动重启|cursorRejectedReason|
|测试broker/沙箱不可用|Live BLOCKED，不退回宿主|计划项留在分母，成本unknown|
|quality任务没有实际fold|不是fold质量样本|mechanism-unexercised，不可推荐balanced|
|H02引用原文丢失|保留失败轨迹，分层定位|不能自动开“新的delta记忆层”|

## 只存必要的非内容观测

每个request记录：run/episode/attempt/request ID、profile、route/config、prepared view hash、applied field count、estimated before/after、purpose、终态、usage来源、缺失项。原文引用使用FieldRef，公开run包只存Hash/短非敏感诊断，不存思考正文。

fold receipt区分planned/applied/sent/confirmed。`savedTokensEstimate`必须带character-estimate标签；费用只在价格和usage口径完整时输出；prefill是engine物理计数，不能叫billed tokens。

canonical history可能由Pi原生保留模型思考；插件不自行检索、导出或重新注入隐藏思考块。当前只投影纯文本toolResult，不扩大类型范围。
