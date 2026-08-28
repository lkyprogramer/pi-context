# 宿主无关公共契约

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义整个项目唯一权威的 TypeScript 接口词汇；其他文档只能引用，不得重新定义同名接口。

## 2. 已冻结决策

- 所有 ID 使用 domain-separated SHA-256。
- SourceClass 与 ActionAuthority 分离。
- HostSessionCursor 使用 sessionId + leafId + lineageHash。
- MaterializedView 返回 HostMessage，不返回 Pi AgentMessage。
- Schema 与 TS 通过生成/一致性检查同步。

## 3. Canonical Types

```ts
export type SourceClass =
  | "system"
  | "authenticated-user"
  | "untrusted-user"
  | "trusted-tool"
  | "untrusted-tool"
  | "external-content"
  | "agent-derived";

export type ActionAuthority = "none" | "inform" | "propose" | "act";

export interface HostSessionCursor {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
  modelKey: string;
  thinkingLevel: string;
}

export interface HostMessage {
  hostMessageId: string;
  role: "user" | "assistant" | "tool-result" | "custom";
  timestamp: number;
  content: HostContentBlock[];
  sourceClass: SourceClass;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface ObservationInput {
  operationId: string;
  cursor: HostSessionCursor;
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: HostContentBlock[];
  details: unknown;
  isError: boolean;
  capturedAt: number;
}

export interface ObservationProjection {
  operationId: string;
  observationId: string;
  rawBlobId: string;
  evidenceIds: string[];
  visibleContent: HostContentBlock[];
  isError: boolean;
  reducer: { id: string; revision: string };
}

export interface MaterializationInput {
  cursor: HostSessionCursor;
  canonicalMessages: readonly HostMessage[];
  currentContextWindow: number;
  maxOutputTokens: number;
  reason: "normal" | "overflow-retry" | "manual-preview";
  now: number;
}

export interface MaterializedView {
  viewId: string;
  outputHash: string;
  messages: HostMessage[];
  sections: MaterializedSection[];
  tokenEstimate: number;
  cachePlan: PromptCachePlan;
  omissions: MaterializationOmission[];
}
```

## 4. Result Discipline

- public inputs/outputs are cloned/frozen or canonical-serializable；
- unknown enum values fail validation；
- absolute paths are never emitted to telemetry；
- raw blobs are referenced by opaque ID；
- hidden reasoning is not a HostContentBlock kind；
- Kernel errors are typed unions, not message matching。

## 5. 不变量

1. 同名 interface 只能在本文和 `packages/contracts` 定义。
2. ActionAuthority 只能通过 channel-bound policy 赋值，不能从文本内容推断。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `reference/contracts.ts`
- `schemas/`
