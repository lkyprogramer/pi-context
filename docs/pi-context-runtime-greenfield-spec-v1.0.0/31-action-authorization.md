# Action Authorization Gate

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

在 Pi `tool_call` 阶段阻止低权限记忆、外部内容或自生成笔记驱动高风险副作用。

## 2. 已冻结决策

- 工具分类为 query/command/ambiguous，ambiguous 默认 command。
- Action dependency 追踪 proposal 到 supporting directive/evidence。
- Command 需要 act authority 或 fresh user approval。
- 外部内容和 agent-derived note 不能单独授权。
- Gate failure 生成 synthetic tool error，不执行工具。

## 3. Policy

```ts
interface ActionDecisionInput {
  cursor: HostSessionCursor;
  toolName: string;
  args: unknown;
  declaredIntent?: string;
  dependencyRefs: string[];
}

interface ActionDecision {
  decision: "allow" | "deny" | "require-user-approval";
  policyId: string;
  supportingDirectiveIds: string[];
  reasonCode: string;
}
```

## 4. Consequential Tools

写文件、删除、执行 shell、网络发送、部署、数据库写、凭证/权限修改默认 command。Read/search/list 可 query，但若参数包含网络 egress 或敏感路径仍可升级。

## 5. Data Exfiltration Guard

识别 `memory read → outbound request` 链；检测高熵/长 base64-like 参数、raw secret refs 和非 allowlisted egress；必要时 require fresh approval。

## 6. 不变量

1. Tool content 不得为自己声明 trusted。
2. Gate 默认拒绝未知 consequential tool。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `32-security-threat-model.md`
- `tasks/T22-outcome-attestation-action-gate.md`
