# Runtime 数据合同修订

## RuntimeSession

```ts
interface RuntimeSession {
  ingestUserInput(event: PiInputEvent): Promise<UserTurnReceipt>;
  ingestToolResult(event: PiToolResultEvent): Promise<ProjectedToolResult>;
  materialize(request: MaterializationRequest): Promise<MaterializedView>;
  prepareCompaction(request: CompactionRequest): Promise<CompactionDecision>;
  acknowledgeCompaction(ack: CompactionAck): Promise<void>;
  search(request: SearchRequest): Promise<SearchPage>;
  read(request: ExactReadRequest): Promise<ExactEvidencePage>;
  branchChanged(event: BranchChanged): Promise<void>;
  recover(reason: SessionStartReason): Promise<RecoveryReport>;
  close(): Promise<void>;
}
```

## Snapshot

```ts
interface RuntimeSnapshot {
  cursor: RuntimeCursor;
  snapshotHash: string;
  sourceEntrySpan: { first: string; last: string };
  heads: RuntimeHeads;
  activeDirectives: DirectiveRecord[];
  claims: ClaimRecord[];
  continuity: ContinuityRevision;
  pointers: EvidencePointer[];
  recentAtomicMessages: HostEnvelope[];
}
```

## Usage

```ts
interface RequestUsage {
  serializedInputTokens: number; // capacity
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  estimatedCost: number;
  tokenizerRevision: string;
}
```
