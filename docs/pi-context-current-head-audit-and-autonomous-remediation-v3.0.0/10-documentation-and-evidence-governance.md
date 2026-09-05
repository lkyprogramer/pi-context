# 文档与证据治理审计

日常开发遵循仓库根 `AGENTS.md` 的开发路径。以下证据治理只在真实 Live、发布、迁移、安全敏感变更或明确的审计任务中启用；不要把它作为普通代码修改的前置门禁。

## 状态真值优先级

```text
GitHub current HEAD
→ Required/Compatibility aggregate
→ immutable run manifest
→ machine-readable gate decision
→ human report
→ HANDOFF / README
```

低优先级文档不得覆盖高优先级事实。

## 当前冲突

- HANDOFF 仍引用旧 HEAD；
- 已有报告的目录保留 UNRUN；
- Protection verifier 通过但分支实际未保护；
- Raw bundle 物理文件、partial 状态和 manifest 语义不完全一致；
- canonical report hash 与 artifact bytes hash 未明确区分。

## Evidence v3

每个任务和 Live Run 必须记录：

- base/head commit；
- dirty state；
- package digest；
- corpus/model/provider/config/scorer hashes；
- 每条命令、退出码、完整日志 hash；
- 每个 artifact bytes SHA-256；
- JSON canonical SHA-256；
- planned/attempted/completed/scored/failed；
- retry history；
- reviewer conclusion；
- claim level。
