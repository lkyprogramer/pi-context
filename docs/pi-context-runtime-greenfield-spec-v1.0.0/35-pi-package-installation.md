# Pi Package、安装与运行

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 npm/git/local 发布包、Pi manifest、dependencies、peerDependencies、启停与卸载。

## 2. 已冻结决策

- 最终包只有一个 `pi.extensions` 入口。
- Pi 核心包列为 peerDependencies，开发依赖固定基线。
- 运行依赖位于 dependencies，不能放 devDependencies。
- 首次启用需要项目 trust 与 PCR readiness check。

## 3. Package Manifest

```json
{
  "name": "pi-context-runtime",
  "version": "0.1.0-alpha.1",
  "type": "module",
  "engines": { "node": "^22.23.2 || ^24.18.1 || >=26.5.1" },
  "keywords": ["pi-package", "context-runtime", "agent-memory"],
  "pi": { "extensions": ["./dist/extension.js"] },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "typebox": "*"
  }
}
```

实际支持版本由 `compat/pi.lock.json`、startup probe 和 CI 决定；peer `*` 避免安装第二份 Pi runtime，并不表示未来版本自动兼容。

## 4. Commands

```bash
pi install npm:pi-context-runtime@0.1.0-alpha.1
pi -e ./apps/pi-context-runtime/dist/extension.js
pi list
pi config
pi update --extensions
pi remove npm:pi-context-runtime
```

## 5. First Run

Extension factory 只注册 Handler，不启动 worker。`session_start` 后创建 dataRoot/key/store、运行 doctor、claim owner、加载状态。`session_shutdown` 清理。

## 6. 不变量

1. Packed tarball 必须在空目录执行 install/e2e。
2. 卸载后不自动删除用户数据；提供显式 purge 命令。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `reference/package-blueprint.json`
- `tasks/T40-package-install-conflicts.md`
