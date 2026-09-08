# 唯一合同（6.1）：写入 `src/contracts.ts`，其他模块只引用

本页是**拟实现**接口；不是当前源码已有能力。允许 breaking change；重命名须一次同步全部调用与测试。生产 Pi 边界直接 `import type { ExtensionAPI, ExtensionContext, SessionCompactEvent, ContextEvent, MessageEndEvent } from "@earendil-works/pi-coding-agent"`，禁止用 `Record<string, unknown>` 自造宽接口。

删除的旧合同：`ExposureLedger`、`AttemptReceipt`、`RuntimeIdentity`、`FrozenEpoch`、`SnapshotKey`、`Proposal`/staging、`Capsule`、`Pin`、`semantic.*`、`checkpoint.*`、`projection.minEpochRequests/minCandidateReduction`。

## 1. 配置

```ts
export interface PctxConfig {
  schemaVersion: 6;
  profile: "off" | "observe" | "balanced";
  storage: { mode: "persistent" | "memory-only"; dbPath: string | null; maxIndexBytes: number };
  history: { searchLimit: number; searchMaxTokens: number; readMaxTokens: number; readMaxBytes: number };
  fold: {
    triggerPercent: number;      // 默认 60；必须 < 85（Pi 默认 reserve 16384 在 262k 上是 93.75%）
    targetPercent: number;       // 默认 40；必须 < triggerPercent
    protectRecentBatches: number;// 默认 4
    minRemovedTokens: number;    // 默认 4096
    minFoldableBytes: number;    // 默认 1024
    stubHeadChars: number;       // 默认 120
  };
  telemetry: { includeContent: false; jsonl: boolean; maxLogBytes: number };
}
export function parseConfig(input: unknown): PctxConfig;          // 未知字段、NaN、负数、越界一律 CONFIG_ERROR
export function loadConfig(cwd: string, projectTrusted: boolean): { config: PctxConfig; configHash: string; source: string; warnings: string[] };
```

## 2. 读取 scope 与字段引用

```ts
export interface Scope {
  workspaceId: string;           // 规范化项目根的 sha256 前 16
  sessionId: string;
  leafId: string | null;
  visibleEntryIds: ReadonlySet<string>;  // 从 leaf 沿 parentId 到根
}
export interface FieldRef {
  v: 6;
  workspaceId: string;
  sessionId: string;
  entryId: string;
  blockIndex: number;
  kind: "text" | "image";
  sourceHash: string;            // text: sha256(UTF-8 正文)；image: sha256(canonicalJSON({type,mimeType,data}))
}
export function refForField(scope: Scope, entry: NativeEntry, blockIndex: number): FieldRef | RefError;
export function encodeRef(ref: FieldRef): string;   // "pctx:6:<base64url json>"
export function decodeRef(s: string): FieldRef | RefError;
```

`refForField` 是 search/fold/read 三处创建引用的**唯一入口**。多 block 不拼接后指到 0；kind 非法、越界、缺 id 返回明确错误码。ref 是完整性信息，不是授权凭据；read 时重新校验 `entryId ∈ scope.visibleEntryIds` 和 hash。

## 3. 检索与回读

```ts
export interface SearchCursor { v: 6; sessionId: string; branchHash: string; queryHash: string; indexRevision: string; offset: number }
export interface IndexedHit { workspaceId: string; sessionId: string; entryId: string; blockIndex: number; sourceHash: string; toolName: string | null; excerpt: string; score: number }
export interface HistoryIndex {
  upsertBranch(scope: Scope, entries: readonly NativeEntry[]): Promise<{ inserted: number }>;  // 只写未见 entry
  search(scope: Scope, query: string, limit: number, offset: number): Promise<IndexedHit[]>;    // SQL 内先 session_id 谓词再 FTS 排序
  revision(scope: Scope): Promise<string>;
  close(): Promise<void>;
}
export interface ReadBudget { maxTokens: number; maxBytes: number; estimateKind: "provider-window" | "character-estimate" }
export function utf8Prefix(text: string, maxBytes: number): string;   // 向后退到码点边界，不向前越界
export function readHistory(req: { scope: Scope; ref: string; cursor?: string; budget: ReadBudget; getEntry(id: string): NativeEntry | undefined }): HistoryResult;
export function formatHistoryResult(r: HistoryResult): { content: ContentBlock[]; details: unknown }; // 图片返回真实 image block
```

`pctx_history` 自己的 toolResult（toolName = `pctx_history`）不进索引。`maxTokens = min(config, caller, ctx.getContextUsage() 剩余安全量)`；窗口未知时用 `character-estimate` 并明确标注。

## 4. 折叠

```ts
export interface ToolBatch {
  assistantEntryId: string;
  calls: readonly { id: string; name: string }[];
  results: readonly { entryId: string; callId: string; isError: boolean; textBlocks: number[]; bytes: number }[];
  complete: boolean;              // 每个 call 恰一个 result
  hasNonText: boolean;
}
export function collectBatches(entries: readonly NativeEntry[]): ToolBatch[];
export function exposedEntryIds(entries: readonly NativeEntry[]): Set<string>;
// 规则：entries 按分支顺序；toolResult e 已暴露 ⇔ 其后存在 assistant entry a：a.stopReason ∉ {"error","aborted"} 且 (a.usage.totalTokens>0 或 a.usage.input>0)

export interface Replacement { entryId: string; blockIndex: number; sourceHash: string; stub: string; originalBytes: number; savedTokensEstimate: number }
export interface FoldPlan {
  planId: string;                 // sha256(sessionId + compactionBoundary + modelId + sorted keys) 前 16
  sessionId: string;
  compactionBoundary: string | null;  // 当前分支最新 compaction entry id
  modelId: string;
  configHash: string;
  createdAt: string;
  usagePercentAtPlan: number;
  replacements: ReadonlyMap<string, Replacement>;   // key `${entryId}:${blockIndex}`
}
export interface ContextUsageLike { tokens: number | null; contextWindow: number; percent: number | null }
export function shouldFold(usage: ContextUsageLike | null, plan: FoldPlan | null, cfg: PctxConfig["fold"]): boolean;
export function planFold(input: {
  scope: Scope; entries: readonly NativeEntry[]; batches: ToolBatch[]; exposed: ReadonlySet<string>;
  usage: ContextUsageLike; previous: FoldPlan | null; modelId: string; cfg: PctxConfig; configHash: string;
}): FoldPlan | null;              // 纯函数；previous 非空时只能追加条目
export function renderFold(messages: AgentMessage[], plan: FoldPlan, mapping: ReadonlyMap<number, { entryId: string }>): { messages: AgentMessage[]; applied: number; firstChangedIndex: number | null };
export function stubFor(r: { toolName: string; callId: string; isError: boolean; bytes: number; sourceHash: string; head: string; ref: string }): string;
```

`renderFold` 在 runner 已 clone 的数组上就地替换，返回 `applied=0` 时返回同一引用。不删消息、不动 assistant/user、不动 image/unknown。

## 5. 遥测与 status

```ts
export interface RequestRecord {
  at: string; sessionId: string; profile: PctxConfig["profile"];
  planId: string | null; replacementsApplied: number;
  contextPercentBefore: number | null;
  usage: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; totalTokens: number | null };
  stopReason: string | null;
  ttftMs: number | null;            // message_start → first message_update of the same assistant message; null if not observed
}
export interface FoldEvent {
  at: string; sessionId: string; planId: string; reason: "threshold";
  added: number;                    // replacements appended by this trigger
  savedTokensEstimate: number;      // Σ(original − stub) over added replacements
  firstChangedIndex: number;        // index in the rendered message array of the oldest replaced message
  invalidatedTokensEstimate: number;// estimated tokens from firstChangedIndex to the end BEFORE folding = prefix-cache cost of this fold
  percentBefore: number;
}
export interface StatusView {
  resolvedProfile: string; configHash: string; configSource: string; warnings: string[];
  hostVersion: string; contextWindow: number | null; contextPercent: number | null;
  activePlan: { planId: string; replacements: number; savedTokensEstimate: number } | null;
  folds: number; nativeCompactions: number; historyReads: number; historySearches: number;
  lastRequests: RequestRecord[];   // 最近 5 条
}
```

`FoldEvent.savedTokensEstimate / invalidatedTokensEstimate` 是折叠经济学在本地栈上唯一需要的两项（[02 §6.1](02-fold-algorithm.md)）；报告以 `removed/invalidated` 列呈现，不参与折叠决策。`ttftMs` 由插件在 `message_start/message_update` 事件上测得，与 harness 独立测得的值互为校验。

`telemetry.jsonl=true` 时追加写 `~/.pi/agent/pctx/telemetry/<sessionId>.jsonl`，只含上述数字/ID，不含任何正文。`RequestRecord.usage` 直接来自 `message_end` 的 assistant `usage`（Pi 已把 `prompt_tokens_details.cached_tokens` 归一化为 `cacheRead`，见 `packages/ai/src/api/openai-completions.ts:1520`）。

## 6. 评测合同（eval/local，与产品隔离）

```ts
export type Arm = "native" | "observe" | "balanced";
export interface EpisodeManifest {
  runId: string; caseId: string; arm: Arm; rep: number; windowProfile: "w262k" | "w64k";
  hostVersion: string; pluginTree: string; tarballSha256: string | null; configHash: string | null;
  model: string; baseUrl: string; thinking: "medium"; seedSession: string | null; startedAt: string;
}
export interface EpisodeResult {
  manifest: EpisodeManifest;
  status: "complete" | "timeout" | "error" | "blocked";
  oracle: { passed: boolean | null; exitCode: number | null; protectedIntact: boolean | null; detail: string };
  requests: RequestRecord[];        // 从 Pi JSONL 的 assistant usage 回填，与插件 telemetry 一致
  mechanism: { folds: number; replacements: number; nativeCompactions: number; historyReads: number; historySearches: number; verifiedReads: number };
  engine: { requestsDelta: number | null; prefixHitTokensDelta: number | null; prefillTokensDelta: number | null; stableRestoresDelta: number | null };
  wallMs: number;
}
```

`engine.*` 来自 `GET http://127.0.0.1:18343/metrics` 的前后差值（`ninfer:prefix_cache_hit_tokens_total`、`llamacpp:prompt_tokens_total`、`ninfer:requests_total`、`ninfer:continuation_stable_prefix_restores_total`）。4090 `--max-concurrency 1`，episode 串行，差值才归属正确。`assertArm(manifest, statusView)`：arm=native 要求插件未加载；observe/balanced 要求 `resolvedProfile` 一致，否则 episode `blocked`，不计入。
