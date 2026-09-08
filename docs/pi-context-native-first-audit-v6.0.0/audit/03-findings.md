# 当前实现问题与优先级

所有位置相对审计HEAD `79c1ead5`。P0先阻断危险live与跨scope检索；P1在启用balanced前修；P2随收口修复。P01–P15是本次实际源码隔离探针，static是数据流审阅，均不冒充线上复现。

| ID | 优先级 | 问题 | 源码 | 证据 | 根因 | 任务 |
|---|---|---|---|---|---|---|
|F01|P1|配置未加载，balanced没有产品激活证据|src/extension.ts:6-9; src/config.ts:56-106|P01/P15|入口固定DEFAULT_CONFIG；嵌套值靠类型断言|A01|
|F02|P1|公共hook使用自定义宽类型，compaction字段读错|src/pi/adapter.ts:7-12,49-53|P10|官方compactionEntry被读作entry，编译没有拦住|A01|
|F03|P1|折叠引用hash口径与read不一致|src/plugin.ts:108-121,193-195; src/history/read.ts:52|P02|canonical JSON字符串hash不等于UTF8正文hash|B01|
|F04|P1|搜索多块结果指向错误字段|src/history/search.ts:36-45; src/plugin.ts:73-78|P03|检索丢blockIndex/sourceHash，统一指到0且使用拼接正文|B01|
|F05|P0|跨session相同entryId可泄漏检索片段|src/history/index.ts:54-92|P05|内存行没有scope字段；仅按allowed entryId过滤|B02|
|F06|P1|游标不推进且不绑定query/scope|src/history/search.ts:21-57|P04|decode后忽略offset，永远取首页|B02|
|F07|P1|持久索引与worker只有外观，热路径全量扫描|src/history/index.ts:1-54,95-101; src/plugin.ts:59-64; src/pi/adapter.ts:14-33|static|默认:memory:；worker未连接；每次history全部upsert|B02|
|F08|P1|历史工具回声过滤无效|src/history/index.ts:59,82|P06|fieldKey永远text:i，不含工具名|B02|
|F09|P1|回读最终预算与多模态合同不成立|src/history/read.ts:39-70; src/commands.ts:history execute|P13/P14|图片不验hash无预算，图片转JSON文本；UTF8向前越界；maxTokens未夹紧|B03|
|F10|P1|暴露确认只验generation且确认伪snapshot|src/projection/exposure.ts:begin/confirm; src/plugin.ts:197-213|P07|未比较session/model/config；includedOriginalRefs在渲染前生成|C02|
|F11|P1|generation回退与会话生命周期未隔离|src/plugin.ts:48-57,noteFence; src/pi/adapter.ts:25-27,57-65|P08|多个generation来源，shutdown不关闭index、不清状态|C03|
|F12|P1|错误工具批次可能被折叠，epoch没有冻结|src/projection/batches.ts:44-68; src/plugin.ts:141-151; src/projection/planner.ts|P09+static|isError未检查；每次过累计阈值重建plan；伪预算不裁决实际output|C03|
|F13|P1|胶囊改了最新用户消息，pin不是有效证据|src/plugin.ts:170-188; src/checkpoint/capsule.ts|P11/P12|lastCapsule充当布尔；固定128k；see original替代原话；pin ref无法decode|C01|
|F14|P1|G4的B2未启用balanced，无法证明机制|src/extension.ts:7; eval/sandbox/g4-agent.mjs:1-170|static|只有加载插件无profile切换；没有epoch/replacement receipt|E03|
|F15|P1|全请求计量与retry证据不完整|src/telemetry/usage.ts; eval/smoke.mjs:77-116; eval/sandbox/g4-agent.mjs:184-190|static|未知按0判empty，覆盖首attempt；totalTokens误名billedTokens|E03|
|F16|P0|判题把不可信代码带回有凭据宿主|eval/live-g4.mjs:119-131,169-213|static|javac/java/mvn宿主执行；Maven仅凭stdout token即可过|E02|
|F17|P1|C2挑战非公平配对且nonce不只在历史|eval/smoke.mjs:77,91; eval/live-g4.mjs:74-80; eval/sandbox/g4-agent.mjs:86-109|static|两臂不同nonce、环境传nonce、B0必须失败、toolCalled未证明使用|E01|
|F18|P1|任务集不能识别大部分压缩回归|eval/live-g4.mjs:16-110; eval/report.ts|static|提示直接含解法、J08允许无compact、null当无违规、选择双方通过评效率|E01|
|F19|P2|实验源码身份与文档/测试覆盖漂移|eval/runner.ts; eval/smoke.mjs:38,129; tsconfig.build.json; docs/CONFIGURATION.md|static|manifest.host代替plugin身份，eval未纳入严格编译，固定目录覆盖，旧PCR配置|E04|
|F20|P1|受控真宿主测试未证明优化确实应用|test/host/*; test/packed/install.test.ts; artifacts/v5-tasks/T26|static|注册hook/加载tarball与实际balanced投影、胶囊位置、end-to-end ref是不同门|D01|

## 关键数据流解读

### F03/F04：能encode并不等于能read

正确ref必须唯一绑定原生entry中的某个字段；若检索找到第二块，ref不能指向第一块。所有生产路径统一调用一个refForField，而不是一处拼接文本、一处hash JSON、一处hash UTF8。范围页hash是page自己的bytes，sourceHash是原字段全集，两者不可交换。

### F05：安全问题发生在“返回摘要”时，不能靠read拒绝补救

现有Map key包含workspace/session，但value丢了这些维度；search遍历所有values，只检查entryId。不同session的同ID（fork复制/复用ID）足以让检索片段越过边界。探针只用合成PRIVATE_FIXTURE字符串，不涉及用户秘密。先加scope谓词，再排序、分页、裁预算；检索和回读必须共用可信scope，不接受模型自选session。

### F10/F11：成功暴露不等于未来所有分支都可剪

一次成功请求只能确认它真的携带的原始字段。切模型、切分支、切session、原生compact后保守清除旧projection资格；普通追加可以复用经过前缀验证的已确认字段。generation不能来自另一个可选semantic proposal。不要恢复旧PCR的复杂Saga；一个session上下文和一份可丢弃epoch即可。

### F12：不能仅检查最终call/result数量

保留消息数、role、toolCallId结构是必要条件；错误文本被隐藏也会破坏任务。isError必须看工具结果真实字段；多个call必须每个恰好匹配一个result，所有当前分支有资格块才参与。未成功消费批次整体保护。不要根据任意assistant“已经解决”就取消错误保护。

### F16：sandbox必须包住判题，不只是包住Agent

即使模型端没有凭据，模型写的Java随后在有凭据宿主执行，隔离就失效。限制cwd无效。先关掉host grader；复用现有Docker镜像新增grader模式，冻结oracle/POM，禁网、最小环境、无broker socket。测试成功由可信判题进程判断，不由候选打印ORACLE_PASS决定。

## 应撤销的旧批评

本分支没有旧PCR工具入口/第二CAS，因此不再开“把reduced.visibleText回接”等旧任务。图片原始tool_result当前没有被入口删除，问题是**history图片回读**的hash、预算和内容类型。当前严格src检查可通过；它不能拦住自定义宽接口和未纳入tsconfig的eval。T17/T18是可选，不应计为核心发布缺失。


## 6.1 修订说明

任务列已从 6.0.0 的 N01–N12 重映射到 6.1 的 A01–E04（见 [tasks/index.json](../tasks/index.json)）。F10 的"ExposureLedger 键/ACK"问题在 6.1 中通过删除 ledger（C01）并改为派生暴露（C02）解决；F13 的胶囊改 user 问题通过删除胶囊（C01）解决，而不是修正其位置。
