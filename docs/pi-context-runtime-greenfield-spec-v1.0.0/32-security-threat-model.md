# 安全威胁模型

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

覆盖 Prompt Injection、Memory Poisoning、摘要洗白、跨 Session、Secret、检索、工具链和供应链。

## 2. 已冻结决策

- 安全边界是 provenance/authority/action gate，不是单一提示词过滤。
- write-time origin binding 不可由后续摘要提高。
- 用户、工具、外部内容、agent output 使用结构化来源标签。
- 所有 memory write 和 retrieval 有审计 receipt。

## 3. Threats

- tool output 注入指令并进入长期 memory；
- agent summary 把 untrusted 内容洗白；
- manufactured corroboration；
- cross-session/branch 数据串扰；
- retrieval poisoning/obsolete fact revival；
- secret/PII 写入 CAS、FTS、telemetry 或 prompt；
- compressed pointer 越权读取；
- context/plugin owner 冲突；
- malicious Pi package 或 reducer supply chain；
- DoS：超大 result、query、regex、SQLite lock、background job。

## 4. Controls

- source-bound authority；
- encrypted per-workspace storage；
- secret scrub before index/render/log；
- no hidden reasoning persistence；
- literal/FTS bounded retrieval；
- signed/MAC cursor；
- action gate；
- conflict check；
- reducer registry hashes；
- security-strict profile；
- adversarial corpus and fuzz gate。

## 5. Non-goals

不能保证任何模型永不被 Prompt Injection 影响；目标是降低持久化概率、阻断低权限内容授权 consequential action，并提供检测、回滚和审计。

## 6. 不变量

1. Critical security failure 不允许自动 fail-open。
2. Security log 不记录完整 tool args/raw content。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `checklists/security.md`
- `tasks/T43-security-fuzz.md`
