# 01 · 调研方法、来源覆盖与本次未完成的验证

## 固定基线

| 对象 | 本次观察值 |
|---|---|
| 用户项目 head | `e14804daf9aa31b342ddca718d789fa6860c2244` |
| 附件／远端完整 Git tree | `15b9e6b170632c6e65d4f277ae83176182a273a3` |
| 附件文件数 | 9,766 |
| 官方 Pi 源码 | `9767ba275f3e9a5ee0f5c5342249b629ab1b2282` |
| 官方源码 package.version | `0.85.1` |
| 目标Node下限 | `22.19.0` |

附件解压检查了路径边界，并按Git blob规则与目录树、可执行位重建完整tree，而非仅比较README。`document-catalog.json`记录docs各文件的哈希、大小和标题；**全目录建索引不等于每份历史文档逐行精读**。深入阅读针对每代执行摘要、核心设计、当前生产数据流、安装／兼容说明、最新版报告与直接相关测试。

## 证据等级

A：固定源码中的可直接检验行为。B：此次真实模块组件探针。C：仓库保留的测试报告。D：第三方项目文档／作者论文／工程经验。E：本方案推理与待验证设计。

报告里的“已通过”必须注明B或C，不能把C写成此次复测，更不能用D直接证明本项目优于Native。所有优化参数和性能门槛是E级设计，需实验确认。

## 搜索覆盖与交叉验证

已使用 Exa 与原始网页检索：Pi context compaction、posthorse、observational memory、smart compact、prompt cache、history recovery、goal/compaction races；扩展搜索到JetBrains observation masking、LCM、Manus、Anthropic、Factory、Mastra。GitHub连接器用于用户仓库和Pi公开源码的读取，避免用搜索摘要猜实现。

| 渠道 | 本次结果 | 使用规则 |
|---|---|---|
| 用户附件／GitHub | 基线对齐、核心源码与保留报告可读 | 用于当前实现判断 |
| 官方Pi | 扩展类型、会话、消息、压缩说明可读 | 公开契约优先于旧帖子 |
| GitHub插件／issue | 多条可核对的一手文档及修复记录 | issue需区分历史故障与当前已修复 |
| X | 多次site检索及自然语言检索未得到可核验相关原帖 | 不宣称覆盖X讨论，不虚构社区共识 |
| Reddit | 检索发现候选和镜像，原帖访问失败／返回不足 | 镜像只启发测试情景，不作为证据来源 |
| 研究／厂商工程文 | 获得作者或官方文本 | 区分基准任务、模型、商业自评与独立复现 |

Reddit候选ID包括`1t6czex`、`1vfufp5`、`1vmemo3`；本包不引用其正文、不复述统计值，也不将镜像当原帖。记录渠道限制，是为了让下一位研究者知道哪部分仍缺一手证据，而不是用更多无关链接填满报告。

## 环境限制

本机Node22.16.0、TypeScript5.8.3可运行独立组件探针；npm/GitHub域名解析在容器失败，依赖安装尝试记录在`evidence/dependency-attempt.log`。GitHub连接器仍可读取源码，但不能代替本地官方Pi的构建与执行。

因此没有执行：完整vitest矩阵、官方Pi loader、packed install/uninstall、真实模型长任务、容器隔离编码实验、第三方论文复跑。新版本不得因为文档生成完成就标记release-ready。

## 可复核产物

[来源索引](../SOURCE-INDEX.md)、[身份比对](../evidence/source-identity.json)、[源码摘录](../evidence/current-source-excerpts.md)、[组件探针](../evidence/audit-probes-result.json)、[保留canary](../evidence/current-canary-report.json)。正文[Sxx]编号均指向来源索引；“设计”段落不伪装成源码已有功能。
