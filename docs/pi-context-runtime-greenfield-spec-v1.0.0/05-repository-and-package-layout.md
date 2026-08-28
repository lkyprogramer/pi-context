# 仓库与包结构

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

固定 Monorepo、发布包、依赖方向、文件职责和禁止的跨包耦合。

## 2. 已冻结决策

- 使用 pnpm workspace，但发布包遵循 Pi package manifest。
- 只发布一个 Pi Extension 入口。
- Kernel 子系统按责任分目录，不拆成多个争抢 Pi Hook 的扩展。
- 所有 Pi 特有类型只存在于 `packages/pi-adapter` 和 `apps/pi-context-runtime`。

## 3. 目标目录

```text
pi-context-runtime/
├── apps/pi-context-runtime/          # npm/pi install 的最终包
├── packages/contracts/               # canonical types, schema, hashes
├── packages/kernel/                  # reducers/evidence/claims/retrieval/materializer
├── packages/storage/                 # worker, node:sqlite, CAS, key management
├── packages/worker/                  # background candidates and maintenance
├── packages/pi-adapter/              # public Pi API mapping only
├── packages/testkit/                 # fake Pi host, fixtures, fault injection
├── tests/                             # cross-package/e2e/compat/perf/security
├── benchmarks/
├── scripts/
└── compat/pi.lock.json
```

## 4. 依赖方向

```text
contracts <- kernel <- worker
contracts <- storage <- kernel
contracts <- pi-adapter -> kernel/storage/worker
pi-context-runtime -> pi-adapter
```

禁止：

- `kernel` 导入 `@earendil-works/*`；
- 任意包导入 Pi `src/`；
- `storage` 依赖 renderer；
- `pi-adapter` 绕过 Kernel 直接写 SQLite 表；
- Extension factory 启动后台资源；资源只在 `session_start` 后启动，并在 `session_shutdown` 关闭。

## 5. 不变量

1. 每个发布 Export 有 packed-install test。
2. 内部包不注册 Pi Extension。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `reference/package-blueprint.json`
- `tasks/T01-workspace-scaffold.md`
