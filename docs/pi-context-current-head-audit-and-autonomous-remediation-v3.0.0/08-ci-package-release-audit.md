# CI、Package、Compatibility 与 Release 审计

## 当前真实状态

| Gate | 状态 |
|---|---|
| format/lint | 通过 |
| unit | 通过 |
| contract | 通过 |
| integration | 通过 |
| acceptance | 通过 |
| strict typecheck | **失败** |
| packed install | **失败** |
| run-bundle verify aggregate | **失败** |
| compatibility 10 cells | **全部失败** |
| Required aggregate | **失败** |
| main branch protection | **关闭** |

## 编译错误族

1. shutdown Event → ExtensionContext 非法断言；
2. 多处 callback implicit any；
3. RuntimeToolCtx 不含 cwd；
4. economics metadata unknown 未收窄。

## 为什么多数测试绿仍不够

Vitest/esbuild 可以转译 TypeScript 而不执行和 `tsc --strict` 相同的类型检查。当前正是典型反例：逻辑测试绿，但生产编译和 tarball compile 红。

## CI 改造

- `build` 必须先运行 strict compile，再生成 tarball；
- `packed-install` 依赖 compile，不允许并行制造“build green / pack red”的歧义；
- Compatibility 只在基础 compile green 后运行，但结果必须独立保留；
- `required-gate` 依赖 typecheck、pack、contract、integration、acceptance、security；
- `compatibility-required` 依赖所有非 advisory cell；
- Publication 只接受同一 HEAD 的两个 aggregate success；
- Branch Protection 必须要求两个 aggregate，并禁止管理员绕过或显式记录绕过。
