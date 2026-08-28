# 范围、非目标与成功标准

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

把新项目的产品范围、首发边界、明确非目标和可量化退出条件固定下来。

## 2. 已冻结决策

- v1 只支持单机本地 Pi Agent；不做分布式共享内存。
- v1 正确性路径不依赖 embedding。
- v1 不实现每请求动态 Tool Schema 改写，只允许 Top-level Turn 边界调整 Active Tools。
- v1 不承诺未知第三方 Context Handler 的组合安全。
- v1 不回滚文件系统、进程、数据库或远程副作用。

## 3. In Scope

- Pi Session/Branch 识别与状态恢复；
- Raw user input 与 expanded prompt 双轨记录；
- Tool Result 原文冷存、来源分类、reducer、Evidence；
- Authenticated Directive、Claim、Continuity；
- Exact/FTS retrieval、主动召回、租约；
- Request-time context materialization；
- Pi native Compaction 自定义 checkpoint；
- Recoverable Saga、故障恢复、安全和遥测；
- AI 可执行任务和持续兼容测试。

## 4. Out of Scope

- 修改 `@earendil-works/pi-agent-core` 或 `pi-coding-agent`；
- 导入 `node_modules/.../src/*`；
- 全局跨项目检索；
- 让模型直接获得加密密钥、绝对存储路径或 unrestricted SQL；
- 把 conversation tree 当作工作区回滚；
- 在线学习型策略或自动调参首发。

## 5. 成功标准

| 门 | 必须达到 |
|---|---|
| Correctness | hard directive recall 100%；tool pair violation 0；unsupported high-risk outcome 0 |
| Boundedness | Pi 活跃消息数和 clone 延迟受 periodic host checkpoint 控制 |
| Recovery | crash matrix 全部可重放；重复恢复幂等 |
| Economics | cost per successful task 不高于最佳简单基线；cache-adjusted 指标报告完整 |
| Compatibility | 支持窗口内 Pi 版本 Contract CI 通过；无私有 import |
| Operations | `doctor`、`recover`、`export`、`gc --dry-run` 可用 |

## 6. 不变量

1. 发布门只允许通过实测改变，不允许把失败改写为文档 waiver。
2. Critical/High 安全门不可豁免。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `40-release-gates.md`
- `43-risk-register.md`
