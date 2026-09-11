# 修订设计：Native管理会话，插件只管理已验证的观察投影

本轮保留现有单包、SQLite索引和官方Pi0.85.1。默认observe不变，balanced显式开启。没有新产品版本号要求、没有宿主patch、没有第二份原文CAS、没有Claim/Continuity图、Pin胶囊或后台LLM。以问题边界修复，而非追求模块数量。

## 1. 四种对象不能再共用一个数组

|对象|来源|允许用途|不能证明什么|
|---|---|---|---|
|ArchiveBranch|当前SessionManager可信祖先链，包括早前压缩掉的原文|精确read/search、来源验证|不表示每项仍在当前请求|
|ActiveView|当前`context` event.messages与ArchiveBranch的唯一字段映射|本次可折叠候选、真实前后计量|不能由全日志token加和替代|
|RequestWitness|本次准备视图、Provider请求观察、对应成功assistant|原文字段至少进入过一次成功请求|不证明模型理解、记住或完成任务|
|AppliedReceipt|render实际替换的字段、前后长度/Hash|折叠确实发生、实际估算节省|不等于货币或物理prefill节省|

ArchiveBranch只沿parentId读取；兄弟分支不是其成员。遇到循环/缺parent导致身份不完整时，balanced不新增折叠，history返回明确degraded/denied。现有buildScope保持，不通过删除权限检查修复行为。

## 2. ActiveView构造

在同一次`context`回调取得branch和messages。先校验message数量/类型，构造当前分支tool call/result的occurrence表；按唯一toolCallId及完整content指纹匹配到本次消息。相同ID或相同内容出现多次且不能用宿主事件ID消歧时，不折叠这些条目。**内容相同不是同一事件。** 只形成实际有位置的text字段，不把旧summary覆盖的raw entry当作候选。

正常路径不修改user、assistant、tool调用参数、消息数量、顺序、ID、非文本block。一个工具结果含图片/未知块，整条保持原文；错误结果和不完整批次也保持原文。最新4个完整批次保护，现有60%/40%/4096/1024参数先不改。

规划输出只是candidate。render再次验证字段Hash；只统计实际应用的字段。新增计划的actual saving若达不到minRemovedTokens，就不发布新epoch，继续使用上个可验证的计划。旧冻结字段不因增长/低压力反复变换。request未发送或Provider失败时，本地render事实仍可记录，但`successfulExposure`不得成立。

## 3. 小型请求见证，而非重建持久化Ledger

新增一个内存`RequestWitnessTracker`，由唯一扩展实例持有。identity包括workspace/session、provider/model、configHash、compactionBoundary、单调epoch/requestSeq。context准备后记录**仍以原文出现**的字段Hash；已经stub化的字段不能据此“再次证明原文已暴露”。

`before_provider_request`只观察，不改写payload。首发支持本项目实际使用的OpenAI-completions形状：校验tool消息的tool_call_id与原始文本映射，record method=`provider-payload`。由于其他插件或Provider序列化可改变输入，不能仅凭自己context输出就声称wire字节已验证。对无法匹配的Provider/多块表示不新增折叠，记录`witness-unavailable`，observe/read仍可用；不私自修改宿主或猜字段。可在后续有实际使用需求时增加小型只读映射器。

同identity且对应assistant终态成功（stop/toolUse，有有效响应标识或usage，非error/aborted/length）才确认字段。重复message_end不重复ACK；user/tool的message_end不影响Tracker。并发请求不能只用一个全局last值；每session串行请求用requestSeq绑定，出现不明并发则不确认。

restart/session_tree/model_select/profile/config/成功compaction（包括willRetry）均使pending见证失效。正常追加叶子允许已确认祖先继续使用；分支跳转时先清理，不能把兄弟请求视作确认。重启后缺少确定证据的字段完整发送一次，牺牲一次成本换取边界清晰，不重建跨进程状态平台。

## 4. Search/read必须是可完成的多轮工具协议

Search第一页建立内存快照：最多128个有权限的字段引用与排序结果，最多16个快照，10分钟TTL。快照保存anchorEntryId、workspace/session、queryHash、configHash、createdAt与字段Hash。游标只含snapshotId+nextOffset+scope标识；续页时anchor仍为当前祖先即可，不因下一条history调用把leaf推进而失效。

读取每页前重新authorize候选字段并核Hash；分支跳到anchor的兄弟、跨session/workspace、query变化、过期/重启找不到snapshot，都返回`stale-cursor`且不自动回第一页。用户/模型可以明确重新search。每页实际扫描位置前进，因预算少返回hits时不得产生无法继续的游标；没有一条可容纳时返回insufficient-context而非空ok。

`nextCursor`必须写入模型可见text JSON元数据，不仅存在于details。文本read cursor必须绑定完整FieldRef/hash、kind和byteOffset；图片分页既有保护保持，跨ref复用cursor拒绝。代理使用拿到的cursor原样继续，无需第二个工具或隐藏参数。

## 5. 索引有界与增量

SQLite仍可用同步实现；每个accepted entry只做一次提取/Hash/INSERT。先查询已索引field identity再加配额；同一entry重复扫描不能消耗预算。session reload/branch导航重新遍历ID可以接受，但应避免重新序列化已知大正文。仅返回新增entryId的增量由插件缓存跟进，缓存可删可重建。

`maxIndexBytes`明确命名/文档为逻辑文本预算，不声称是SQLite物理大小。记录物理文件bytes作诊断；不要为了精确磁盘配额引入worker/GC服务。HOME/root scope中persist=false使用memory-only索引。索引满/不可用时history.read仍从canonical session恢复，search明确degraded，不冒充空命中。

## 6. 最小收口

保留`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm smoke`；R01新增一个简单`pnpm check`聚合当前命令。CI只有check和stock Pi packed smoke，不恢复旧tests/packages/0.84.4。所有模型测试在本机、按预算、通过无真实Key的Agent沙箱。报告输出一个manifest和attempt/request事件即可，不再任务状态机、签名证据或强制分支保护。

参数调优不属于本轮基础修复。正确性、统计和隔离通过后，若仍无净收益，再单独做最多两个预登记策略的ablation；不要在同一次结论运行中修改oracle、折叠阈值或模型上限。
