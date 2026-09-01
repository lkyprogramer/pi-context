# 测试流程与 CI 可信性审计

## 当前 CI 事实

| Workflow | Run | 状态 | 含义 |
|---|---:|---|---|
| required | 33478592667 | success | Node 22 主流水线全绿 |
| compatibility | 33478592798 | failure | Node/OS Matrix 不成立 |

失败不是存储 flaky，而是 W1 Gate 在 Node 24 环境返回 `keep-recovery-only`，Unit Test 却硬断言 `proceed-to-w2`。

## 为什么这是测试架构问题

`vitest.unit.config.ts` 同时收录：

- unit/package tests；
- integration；
- E2E；
- performance；
- W1/W2 economic gates；
- release；
- fault/security。

这使 unit 既不快、也不纯、也不确定。一个机器性能变化会让 Compatibility 全红。

## 正确 Lane

| Lane | 网络/Provider | 主要目标 | Merge/Release |
|---|---|---|---|
| unit | 禁止 | 纯函数/状态机/Codec | PR required |
| contract | 禁止 | Pi public API/schema/version | PR required |
| hermetic integration | 禁止 | SQLite/CAS/Saga/RuntimeSession | PR required |
| packed | 禁止 | tarball/clean home/type/loader | PR required |
| live-smoke | 真实 | 端点/Hook/少量行为 | protected/nightly |
| publication | 真实 | 完整 B0/B1/B2/F0+统计 | Release only |

每个文件只允许属于一个 Lane；用元测试计算 glob 交集。

## Branch Protection

当前 `verify-protection.mjs` 仅解析 `required.yml` 中是否出现 job name。它没有调用 GitHub API，也不能证明规则已配置。GitHub rulesets 返回空；classic protection 因权限未能核验。因此只能说“Workflow 定义了 required jobs”，不能说“Branch Protection 已启用”。
