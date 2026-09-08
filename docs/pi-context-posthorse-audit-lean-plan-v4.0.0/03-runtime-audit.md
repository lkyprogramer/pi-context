# 运行实现深审：先修四条数据链

本章与 [findings.json](findings.json)、[源码摘录](evidence/source-excerpts.md)、[隔离执行结果](evidence/isolated-reproductions.json)互相对应。没有把原函数的隔离行为写成完整宿主实测。

## 1. Reducer没到模型：F01

`createObservationService` 持久化文本后返回 `[pcr observation pointer] ctx://observation/blob_…`。默认组合根随后执行Reducer，将高信号结果写入Evidence，但返回值只是：

```ts
return Object.freeze({
  ...projected,
  evidenceIds: admitted.map(record => record.evidenceId),
  reducer: { id: reduced.reducer.id, revision: "1" },
});
```

缺少的不是一个更强摘要Prompt，而是 `visibleContent` 的赋值。Tool Hook又直接将这个字段返回给Pi。因此模型看不见刚跑出的 `FAILED: UserServiceTest; exit=1`，要再学会读一个句柄才知道失败。即便后台存储百分之百可恢复，这也是人为增加工具轮数和行为不确定性。当前pointer是blobURI，模型公开读取工具主要接受Evidence ID，还应统一句柄契约。

最小修复：短输出透传；大输出采用“退出状态+失败/改动摘要+有效Evidence ID”；明确未展示范围。不返回全量日志、不让索引文本充当已执行结果、不把任务成功等同于isError=false。

## 2. 身份与版本被混成一个Cursor：F02/F13

当前 `derivePiSessionContext` 读取leaf和全branchIDs，lineageHash是当前路径的版本指纹。每次append都会改变它。另一方面，Runtime缓存、Evidence读取、FTS筛选、Blob访问都绑定该精确Cursor。新游标读取旧记录被 `PCR_EVIDENCE_SCOPE_MISMATCH` 拒绝；真实FTS在服务验证之前就会按leaf/lineage过滤掉它。

隔离探针创建同workspace/session/model但leaf从A变B的reader，让repository返回真实旧记录；原服务仍拒绝。这证明原函数的权限模型行为，不证明所有现实调用都走同路径。默认组合根和SQL的静态链路使其成为高优先级产品风险，必须用T02的真实append→read验收最终关闭。

应拆为：

- **SessionIdentity**：workspace+session，持有唯一序列写队列。
- **SourceRef**：原始事件ID及来源branch，永久审计位置。
- **BranchView**：当前head的祖先集合；用于查询/读取授权。
- **SnapshotFence**：head、model、system/tools/config/reducer版本；使准备候选失效，而不是销毁读权限。

同一分支祖先可见；共同祖先可见；兄弟分支新事件默认不可见；模型切换不自动剥夺已有历史的读取权；显式安全策略可比模型更严格。Blob解密仍按原record的加密域进行，先校验当前view有读取它的权限。绝不能简单放宽为整个workspace全部可读。

现有新用户认证回填是一项重要修复，却只在Compaction准备处建立当前投影，不能替代工具Evidence的全程祖先访问规则。

## 3. 去重抹掉活动动作：F03

MessageCodec把Pi原始toolCall保留在opaque envelope，但normalized.content中没有toolCall正文。dedup再按role+normalized.content比较，所有纯工具调用都变成assistant+[]。两个结果同为OK也会合并。

原函数联合探针输入5条：用户→call1→result1→call2→result2，只剩3条。即使剩下call/result形式仍配对，**第二个动作与结果已被删除**；所以只测orphan=0不够。

修复原则：保护活动原始事件，事件ID去重只防同一事件重复注入，不根据内容合并不同事件；仅对PCR生成的补充片段去重。历史压缩按完整tool-batch选择，不用role/text近似还原配对。不把“最后用户消息必须最后”套到执行中的tool turn；有未消费结果时应保留真实协议顺序，不能把用户消息插到call/result之间。

## 4. 多模态在CAS前丢失：F04

Tool Hook将非text块改为空字符串，服务又只拼文本存储。图片输出等价于存了空文本，`isError=false`依然正常。修复须先定义版本化ObservationEnvelope：原始content、必要details、toolName、callID、isError、source；以完整JSON/二进制Blob保留，再生成模型视图。第一阶段不支持某类块时，保留该块透传并标记bypass，不能声称已做exact recovery。

## 5. 热路径与缓存：F13

Posthorse的“无提醒不扫history”比当前再加一层FTS cache更直接。PCR每次派生Cursor全量getBranch，并为新cursor积累session/service/cache实例；FTS cache的total_changes又会被usage/lease写失效。先修稳定session和增量branch index，再测P95。没有性能实测就不宣布O(1)或几十毫秒SLO已达成。

## 6. 不需要全面重写

继续使用现有SQLite/CAS、认证User Ledger、持久Compaction Journal、Lease、Reader工具和RuntimeSession；不另建第二套存储。关键改造集中在身份/可见性、输出投影、活动消息选择、计量和测试入口。旧业务数据不能被自动清空；新测试用临时库，涉及生产schema改变时保留只读备份并显式停止不支持版本。
