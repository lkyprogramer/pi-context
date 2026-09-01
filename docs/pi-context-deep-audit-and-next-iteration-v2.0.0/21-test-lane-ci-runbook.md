# 测试 Lane 与 CI Runbook

## Lane 所有权

```text
tests/unit/**               -> unit
tests/contract/**           -> contract
tests/integration/**        -> hermetic-integration
tests/acceptance/**         -> product-acceptance
tests/packed/**             -> packed-install
tests/live-smoke/**         -> live-provider-smoke
tests/publication/**        -> publication-benchmark
```

用元测试解析 Vitest glob，交集非空即失败。

## PR Required

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm check:boundaries
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:acceptance
pnpm test:packed
pnpm oracle:validate
pnpm security:fast
```

要求 Ubuntu+macOS、Node min/current；latest/next 可 advisory。

## Nightly/Protected

- live provider B0/B1/B2 smoke；
- Provider payload/token calibration；
- cache performance；
- crash/kill matrix；
- branch/restart recursive smoke。

## Publication

- 当前 HEAD clean；
- protected branch；
- immutable corpus/run bundle；
- 30+ independent clusters×3+ replicates；
- natural threshold/overflow/recursive；
- independent offline rescore；
- Required 与 Compatibility 同时绿。

## 禁止事项

- 在 Unit 中断言真实墙钟性能；
- 把 live 失败改成 skipped 来维持绿；
- 多个脚本名指向同一个合成 runner 却报告成不同 Lane；
- 使用开发者 Home、凭证或绝对路径；
- 将 `continue-on-error` 的 advisory 结果计入 supported matrix。
