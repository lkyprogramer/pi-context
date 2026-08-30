# 领域模型与合同

## User Turn 是兜底真相

```ts
interface UserTurnRecord {
  userTurnId: string;
  cursor: RuntimeCursor;
  rawTextHash: string;
  rawBlobId: string;
  utf8Bytes: number;
  hostMessageId?: string;
  sourceClass: "authenticated-user" | "untrusted-user" | "agent-derived";
  capturedAt: number;
}
```

Directive 是可检索索引，不是唯一记忆：

```ts
interface DirectiveRecord {
  directiveId: string;
  userTurnId: string;
  exactQuote: string;
  utf8ByteRange: Range;
  utf16Range: Range;
  kind: "goal" | "constraint" | "prohibition" | "correction" | "permission" | "format";
  polarity: "must" | "must-not" | "may" | "is" | "is-not" | "unknown";
  key?: string;
  value?: string;
  status: "active" | "superseded" | "resolved" | "retracted" | "contested";
  supersededBy?: string;
}
```

## Evidence

所有高风险结果必须由 tool/host receipt 证明。Assistant 文本最多具有 `propose` authority。

## Stable IDs

ID 输入必须包含 workspace/session/branch/source host entry/content hash，不能使用数组 index 或进程常量。
