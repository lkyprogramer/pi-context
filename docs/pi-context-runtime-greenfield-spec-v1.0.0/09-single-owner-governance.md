# 单一扩展 Owner 与插件冲突治理

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

解决 Pi 缺少 Context Handler singleton/priority 的现实风险，明确可保证与不可保证的边界。

## 2. 已冻结决策

- 最终 Pi 包只注册一个 Extension factory。
- 进程内使用 `Symbol.for` 防止 PCR 重复加载。
- Known conflict registry 在 startup 检查已知 context/compaction 插件。
- Strict profile 遇到已知冲突拒绝 active mode。
- 未知第三方 Handler 的顺序无法被 Pi API 强制保证。

## 3. Owner Claim

```ts
const OWNER = Symbol.for("pi-context-runtime.owner.v1");
interface GlobalWithOwner { [OWNER]?: { version: string; instanceId: string } }
```

重复实例必须报 `PCR_OWNER_ALREADY_CLAIMED`，不能静默启动第二个 Context Manager。

## 4. Known Conflict Policy

已知冲突类别：

- 注册 `context` 并重写完整历史；
- 注册 `session_before_compact` 并返回 CompactionResult；
- 注册 `tool_result` 做不可逆裁剪；
- 直接进行 branch mutation。

配置允许 `deny`、`warn`、`allow-with-unsupported-status`。默认 balanced 为 `deny-known`。

## 5. Integrity Probe

`context` 生成 `outputHash`；对明确支持的 Provider Payload，可在 `before_provider_request` 验证 message hash。验证失败时 strict 模式中止请求。由于 Payload 结构依 Provider 而异，该 probe 不能替代 Owner 约束。

## 6. 不变量

1. 不得宣称未知插件冲突已从宿主层消除。
2. Owner 检查不读取或执行第三方源码。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `adrs/0003-single-pi-extension-owner.md`
- `tasks/T04-single-extension-orchestrator.md`
