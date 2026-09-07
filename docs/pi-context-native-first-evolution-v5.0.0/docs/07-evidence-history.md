# 07 · 历史证据、索引、范围和精确恢复

## 1. Scope与来源定位

运行时scope由宿主生成：`workspaceId + worktreeId + sessionId + visibleAncestorSet`。workspace基于规范化项目根，不使用模型参数；linked worktree可以共享底层索引文件，但授权仍按各自会话可见祖先。非Git目录以规范化cwd作为工作区，cwd为HOME或文件系统根时默认只观察、不建立持久项目索引。

`SourceRef`包含版本、workspaceId、sessionId、entryId、字段选择、规范化来源hash。对模型返回opaque ref，不接受任意文件路径。opaque不是秘密；权限必须由当前宿主scope校验，而不是靠ref难猜。

分支查询步骤固定为：确定可见entry集合 → 匹配来源／文字 → 稳定排序 → 去重 → limit／分页。不能先全局topK再过滤，也不能空结果时自动回退到其他项目或兄弟分支。

## 2. 真正的来源层级

原生entry记录“当时模型／工具看见了什么”。原生文件路径指向“现在可读取的文件”，两者不同。索引只存检索所需的规范文本、entry/hash/父关系及少量标签；精确回读重新读取native entry并核对hash。

默认不复制完整会话到第二个CAS／数据库。对原生截断以外的字节不作承诺；fullOutputPath在已授权根内且仍存在时可单独提供`current-file`读取建议，但不得把它冒充原始历史。未来要增加外部artifact快照，必须单独设计捕获时机和成本，不能假定tool_result hook能看到底层完整stdout。

## 3. 精确性定义

`native-entry-exact`：宿主返回的当前entry结构与已记录规范hash一致；不承诺原始JSONL序列化空格／字段顺序。

`text-range-exact`：取明确text block的UTF-8字节范围，边界不切断字符，返回范围、完整块hash和page hash。重组所有页等于该块UTF-8内容。

`normalized-search-excerpt`：用于检索提示，可能折叠空白／截短／脱敏，明确不可当exact。

`current-file-content`：当前磁盘观察，必须有新的工具执行证据；不能由history工具悄悄代读。

图片回读返回原生image content块和MIME，不把base64包装成聊天文本。图片或未知类型无法安全计预算时拒绝该次展开并返回明确原因；不会把原始输入图片删除。

## 4. SQLite派生索引

使用Node内置sqlite在专用Worker线程执行，避免同步FTS／建库卡住context钩子；不引入常驻daemon或外部数据库。T01/T07验证目标Node版本的模块行为、FTS5和打包Worker路径。若不可用，退回有上限的内存扫描并显示degraded，不安装另一个不透明服务。

索引事务包括source行、text blocks及FTS更新；游标在事务提交后推进。进程崩溃后根据最后游标和源hash重建。唯一键使用workspace/session/entry/field/hash，fork复制不能导致兄弟授权复用。目录0700、文件0600；Windows按可用权限保护并说明限制。

`contracts/index.sql`是最小schema，不包含二级summary DAG。索引是明文派生文本，不能宣称端到端加密。原生会话本身也可能包含敏感信息。提供memory-only配置；persistent模式的本地副本与模型回读须在安装说明中说明。

## 5. 搜索和回读预算

search默认最多8条、总预览最多1500估算tokens；read默认最多3000估算tokens，单次硬文本字节上限32KiB。每次根据当前可用余量再向下调整；含图片时单独核算，不假设一个固定765常量适用于所有provider。

如果剩余安全容量不足以返回最小有效页，返回`insufficient-context`和相同cursor；不强迫继续读取、不调用ctx.compact。cursor包含query／scope／sourceRevision校验，跨branch、配置变更或源缺失返回stale而非读取其他数据。

所有history调用本身可由Pi正常记录；FTS默认排除pctx_history回声和胶囊生成文本，避免检索自我复制。原文的命中优先于旧摘要；可见性判定始终优先于排序。

## 6. 缺失与损坏

原生source被用户删除或修改：标记source-missing/source-changed，旧索引不再提供exact，相关投影失效。索引损坏：关闭投影并重建；无任何数据库写入必须成功才能继续用户对话的前置条件。

范围不匹配、恶意ref或路径注入：回读失败关闭，不回传跨范围片段。正确区分**优化故障fail-open到Native**与**数据授权失败fail-closed**。

设计依据：[S08–S10、S13、S15、S24](../SOURCE-INDEX.md)。
