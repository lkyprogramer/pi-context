# 基线、附件与证据边界

## 三个不同对象

| 对象 | 固定身份 | 本次用途 |
|---|---|---|
| 后上传源码 `fe108c72-5bda-4a3c-b47d-5a690c827488.zip` | bb7aea1…；SHA256 df5aa843…35ae | 唯一当前源码 |
| 前一重复附件 `8afe5caf-b0ce-4992-ac8a-eab40a144f26.zip` | 0e684e3…；SHA256 ecf97980…ee8e | 旧源码对照，不混用测试 |
| 上次完整交付 `pi-context-audit-v3.0.0-complete-repacked.zip` | SHA256 9da7f212…3d4；112文件 | C00–C31规范对照 |

不仅核对ZIP注释：本次按Git blob/tree规则，从ZIP里的文件字节、可执行位和符号链接重建树，得到 **19a5b264ec57ae2ab69fb16f3433067354c1f6b1**，与GitHub当前HEAD的tree一致。见 [原始核验](evidence/zip-tree-verification.json)。

## 近期提交的实际方向

本轮关键提交包括：a8ed6ff（读取预算/认证分支恢复）、5e457d9（真实入口回放、臂证据）、7ca436b（移除云端Provider CI）、9814cfe及bb7aea1（报告与归档）；此前编译、持久Lease、Scope Resolver、成本分层等修复也已进入当前树。评价依据是当前运行路径和代码，不按commit message是否写了fix判完成。[S1]

## 最新报告是否真的属于当前代码

报告绑定 `ba25c24… + 当时未提交源文件`，不是直接绑定最后文档提交bb7aea1。补充manifest记录628个source-set文件；本次独立核对 **627个同路径完全相同，0个同路径内容不符，1个脚本缺失**。缺失脚本是 `scripts/run-supplement-live.sh`；报告称其迁到 `.sh.txt`，但当前附件中也没有该归档件。因此：

- 主要运行代码可与冻结候选进行逐字节关联，不能简单说“commit不同所以结果无效”。
- 这不是完整Git树的来源证明；源文件集合不包含所有运行环境与工具服务状态。
- 缺失的脚本是一次性supplement，不影响627项已比对事实；其迁移哈希只能视为报告声明，未独立重验。

`report.json` 原始SHA256已复算为 `2fb72ab5f8fa1f44da27fc57e8078d64f689ffa1283e1fced98b57b54094005d`。本包不复制含可能敏感回答的整份原报告，提供经过字段白名单提取的300行指标和独立聚合脚本。[S2]

## 证据分级

| 等级 | 本次完成 | 不能推导什么 |
|---|---|---|
| A：原始源码+原函数隔离执行 | scorer、codec/dedup、observation、tool_result、EvidenceService | 不等于完整Pi运行 |
| B：既有报告的独立复算 | 300行、成功分母、失败、配对、指标 | 不等于重新执行模型/验证所有回答 |
| C：远端同HEAD CI日志 | strict/packed成功，unit805/806及具体失败，矩阵步骤 | 不等于在本地平台复跑 |
| D：报告自述/静态推断 | 脱敏tar扫描、原本地DB、长期隐患 | 必须标明未独立验证 |

本地Node为22.16.0，不是项目目标22.19.0；无node_modules。实际尝试Corepack获取pnpm时 registry.npmjs.org DNS EAI_AGAIN，记录在 [环境日志](evidence/pnpm-environment.log)。故没有编造完整Vitest通过。Python launcher三项测试实际通过；其命令为替身，不调用Provider。

## 未纳入分发

本包不带真实密钥、原始SQLite、原本地auth/models文件、未经重新审查的全部会话。缺失敏感原件应保留为证据限制，不为了“完整可下载”重新泄露它们。完整是文档、任务和可复算指标完整，不是所有原件公开。
