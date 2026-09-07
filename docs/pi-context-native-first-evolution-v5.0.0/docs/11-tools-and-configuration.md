# 11 · 最小工具面、配置与可观测性

## 仅一个模型可见工具

`pctx_history`，固定两个动作：

```json
{"action":"search","query":"PaymentService timeout","limit":8}
```

```json
{"action":"read","ref":"pctx:v5:opaque-source-ref","cursor":null,"maxTokens":3000}
```

参数严格校验、拒绝额外字段。模型不能指定workspace、session文件路径、all-projects、跨branch标志；这些由当前宿主scope决定。search结果给出处、匹配片段、historical标记与可继续的cursor；read根据真实内容类型返回文本或image块。完整模型见`contracts/model.ts`，协议向量见`fixtures/protocol-cases.json`。

## 人类命令

`/pctx status`、`/pctx doctor`、`/pctx profile observe|balanced|off|experimental-semantic`、`/pctx pin ...`、`/pctx unpin <pinId>`、`/pctx export`。export默认只导出无内容诊断；导出原文需独立确认。命令不自行执行当前任务，不扮演Goal Loop。

模式切换及pin变更应显示简短效果说明。TUI／RPC支持程度按ctx.mode/hasUI处理；无交互场景不能伪造用户确认，返回明确需要用户发起的命令。

## 配置位置及信任

用户全局`~/.pi/agent/pctx-v5.json`保存profile与数据路由选择；项目`.pi/pctx-v5.json`仅在`ctx.isProjectTrusted()`为true时允许覆盖无敏感配置。项目配置不得指定外发地址、读取额外根目录或绕过provider同意。未知配置字段报错并退回observe，而非默默忽略拼写。

示例见`contracts/config.example.json`。参数是保守实验起点，不是“官方推荐最优值”。配置schema由T02实现，读取后立即验证，source/config hash进入epoch。

## 预算字段

`history.searchMaxTokens=1500`、`readMaxTokens=3000`、`readMaxBytes=32768`；`projection.protectRecentBatches=4`、`minEpochRequests=8`、`minRemovedTokens=4096`；`checkpoint.maxTokens=1000`。模型窗口较小时按可用余量减小可选注入，不减小不可损伤原文。价格表缺失不以免费处理。

## 指标

每请求记录随机runId、generation、profile、来源映射成功数量、变换数量、估算token及估算方法、firstChangedIndex、hookWallMs、scope拒绝数、source missing数、recall数量及结果码。

按任务额外记录provider原始usage字段和归一化后的input/cache/output、实际账单适用价格及币种、辅助摘要usage、重试／失败usage、总wall time、测试oracle结论。token记录与正文分离，不把prompts／工具输出复制进日志。未知价格／usage为null并记录原因。

`exposureConfirmedCount`不能命名为“模型理解数量”；`sourceHashMatched`不能命名为“答案正确”；`estimatedRemovedTokens`不能命名为“已节省费用”。这些命名是产品验收项。
