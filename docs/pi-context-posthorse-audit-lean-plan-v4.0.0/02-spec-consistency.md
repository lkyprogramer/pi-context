# 与上一版C00–C31的一致性

逐项结果见 [32项对照CSV](compliance/previous-plan.csv)。状态区分 `verified-code`、`partial`、`not-demonstrated`、`re-scoped`，不计算一个容易误导的完成率。verified-code仅表示相应代码/窄证据满足，不是产品发布完成。

## 本轮应正式确认的修复

严格编译恢复；生产打包与clean-install通过；Shutdown/Tool上下文的显式类型修复；Lease已进入SQLite；用户/工具入口调用RuntimeSession；Materialize/Compact开始共用事务snapshot；持久Stage/Ack；B2明确成为主候选；seedUnsupported重复口径；报告明确保留超时；字节哈希与canonical对象哈希区分；恢复开始使用真实读取函数；云端Live密钥被移除。[S1/S2/S3]

这些修复不应因新问题被否认。尤其t31失败不表示旧类型修复无效。

## 部分实现但不能按原验收关闭

**Runtime唯一性：** 入口形式上经过RuntimeSession，但Owner以每个变化cursor建新实例；权限又按精确cursor查询。不能只测试同一个固定cursor并据此关闭“跨轮可恢复”。

**收回读：** 页预算、UTF边界、避免回声已做；但原始工具观察被指针化、祖先证据权限不匹配、最新基准恢复分母为0。读取功能存在不等于跨轮业务链有效。

**经济性：** 类型层已经分logical/effective/monetary；Live JSON仍主要保存最后请求input，且错误把summary估算当物化视图。不应用合同名替代实际数据来源。

**真实语料和闭环：** 100个参数化ID与3次重复是合成测试，不等于100独立真实任务。少量Codex日志dev有价值但不是独立Pi holdout。工具启用后工作区仍为空，更不能把问答通过当代码任务完成。

**发布：** 编译与packed恢复，但unit/compatibility红灯、原始恢复未测、真正的成本与长程任务质量未证实；报告保持不发布正确。

## 本包正式调整原要求

| 旧要求 | 新决策 | 原因 |
|---|---|---|
| Branch Protection为所有开发/试用硬门 | 可选治理；启用时检查必须真实 | 单人项目不应为管理员权限阻塞修复；不伪造protected=true |
| 每轮100×3四臂权威门 | 修复阶段12任务×2重复×2主臂 | 独立场景优先，避免四小时跑必败门；大样本留广泛声明阶段 |
| 多Node、多OS重复全量门 | 日常一个锁定Node；集中验收补目标macOS/Linux | 不宣称没测版本兼容；消除重复min=current |
| 每Task完整日志封印与复杂控制器 | task.json+关键命令日志+source/experiment身份 | 仍可复查，但不给AI增加复杂流程系统 |
| 所有多层记忆必须先完成 | 保留现结构，修最短纵向链；语义后台关闭 | 没有证据值得再加一层 |
| stock Pi零修改的早期承诺 | 说明现状：PCR认证补丁；本轮不换Posthorse fork | 事实优先；v3已承认patched0.84.4 |

以上属于需求收敛，不是将未完成任务伪装为通过。C05/C24/C31等在旧验收下仍未通过，但个人迭代不必无条件追逐旧门。
