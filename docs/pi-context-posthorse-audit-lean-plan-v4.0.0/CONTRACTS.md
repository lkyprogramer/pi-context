# 目标接口与不变量（本包唯一合同）

本章是**待实现目标**，不是声称当前仓库已导出这些符号。新接口由所列Task创建。已有公共合同可保留别名但不建第二套业务逻辑。下例省略的是项目已有Blob/Evidence品牌类型，不允许省略运行验证。

## T02：来源权限与快照拆分

路径 `packages/core/src/identity/branch-access.ts`：

```ts
export interface SessionIdentity { workspaceId: string; sessionId: string }
export interface EntryLink { id: string; parentId: string | null }
export interface BranchView extends SessionIdentity {
  headId: string;
  ancestorIds: ReadonlySet<string>;
}
export interface SourceLocation extends SessionIdentity { entryId: string }
export function buildBranchView(
  identity: SessionIdentity, entries: readonly EntryLink[], headId: string
): BranchView;
export function canReadSource(view: BranchView, source: SourceLocation): boolean;
```

buildBranchView从head反向校验父链，缺节点/环/冲突ID拒绝；会话header可作为显式root节点。与当前分支无关的兄弟节点不因存在于entries中就可见。只比较source.entryId属于当前祖先集合，workspace/session必须同时相等。source还须来自可信ledger绑定，不允许模型自填一个祖先ID伪造证据来源。

`RuntimeSession`稳定按SessionIdentity注册，方法接收当前请求view/fence；原始来源cursor用于审计和解密域。EvidenceRepository按identity+ID取候选，再用SourceLocation鉴权。模型/System/Tools变化只使候选fence失效。未关联host entry的prepared观察不可跨请求检索；下一次context读取宿主已提交entries完成幂等关联。

## T03：完整观察与可见结果

路径 `packages/runtime/src/observation-envelope.ts`：

```ts
export interface ObservationEnvelope {
  format: "pcr-observation-v1";
  toolCallId: string;
  toolName: string;
  content: readonly unknown[];
  details: unknown;
  isError: boolean;
}
export function encodeObservation(value: ObservationEnvelope): Uint8Array;
export function decodeObservation(bytes: Uint8Array): ObservationEnvelope;
export function renderObservationView(input: {
  original: ObservationEnvelope;
  reducedText: string;
  evidenceId: string;
  budgetTokens: number;
  estimate: (text: string) => number;
}): { content: readonly unknown[]; mode: "verbatim" | "reduced" | "bypass" };
```

编码使用确定性规范JSON UTF-8，禁止undefined/NaN/不可序列化值悄悄消失，Binary由base64带type保存。原始details敏感值不直接回传模型；security层按源/视图不同策略处理。decode(encode(x))须深等价。一个空text和一个image不能得到同一raw内容hash。render短结果全保真；长结果用reducedText，附实际可被context_read识别的Evidence ID，metadata预算计入；unknown block采用bypass而不是删除。

## T04：活动事件保护

不新增语义去重器。现 `dedupMaterializationMessages` 保留函数入口，但：active只允许按同一hostMessageId去重；不同ID无条件保留顺序及opaque原始block。派生directory/directive的去重只能移除有相同来源或同一ID的重复投影。tool-batch完整性使用原始content中toolCall.id与toolResult.toolCallId，不能看normalized空content。

## T05/T08：计量

路径 `packages/runtime/src/telemetry/request-usage.ts`：

```ts
export interface RequestUsage {
  requestId: string;
  sessionId: string;
  phase: "compact" | "continuation" | "recall" | "retry";
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  inputSemantics: "exclusive-cache" | "inclusive-cache" | "unknown";
  elapsedMs: number;
}
export function logicalInput(u: RequestUsage): number | null;
export function totalTaskUsage(rows: readonly RequestUsage[]): {
  logicalInput: number | null; output: number | null;
  knownRequests: number; totalRequests: number;
};
```

exclusive-cache返回input+cacheRead+cacheWrite；inclusive-cache返回input，不能再加cache；unknown返回null。任何必须字段未知则对应total为null，另外保留known subtotal不可冒充total。每requestId至多一个最终usage，流式累计更新不能重复相加。异常仍保留耗时及已知token。

## T06：原文分页

`packages/pi-adapter/src/tools/read.ts`与`packages/pi-adapter/src/tools/recall.ts`共用`packages/core/src/retrieval/bounded.ts`底层函数，不复制两份。标准参数为Evidence ID、byteOffset、maxBytes；工具外层保留现有可用参数并显式标注UTF16/text offset转换，不允许同名offset混义。

UTF8字节页的offset必须在codepoint边界，否则返回 `INVALID_BYTE_OFFSET`；end向前收敛到边界；返回nextByteOffset严格增加。header/footer计入上下文预算。原始二进制或图片读取保留typed block，不用UTF8转换破坏。当前一次完整解密仍是事实，未实现chunk encryption前不宣称峰值内存降低。

## T07：判分

scorer输入只接受reader最终答案/结构化答案，摘要不可通过调用接口传入。新题采用JSON `{"answer":"7","kind":"requested-target"}` 等小格式；不强制模型流式工具使用结果嵌在同JSON。旧自由文本回放保留diagnostic模式，明确引用不判summary；自相矛盾输出为ambiguous。ArtifactCoverage独立从产物+oracle获得，Recovery独立来自实际读取。

## T08/T10：实验对象

```ts
export interface Scenario {
  id: string; clusterId: string;
  provenance: "real-independent" | "adapted-real" | "synthetic";
  mode: "reader" | "coding";
  prompt: string;
  oracle: { kind: "requested-target" | "observed-state" | "permission";
            expected: string; sourceEntryId: string; sourceSha256: string };
  sourceEntries: Array<{ id: string; role: "user" | "tool" | "assistant"; text: string }>;
  workspaceFiles: Record<string, string>;
  assertions: Array<
    { kind: "file-equals"; path: string; expected: string } |
    { kind: "command-exit"; argv: string[]; expected: number } |
    { kind: "file-unchanged"; path: string; originalSha256: string } |
    { kind: "export-signature"; path: string; name: string; parameters: string[] } |
    { kind: "forbidden-action-count"; expected: 0 }
  >;
}
export interface RunIdentity {
  sourceSetSha256: string; hostPatchSha256: string;
  modelFingerprint: string; corpusSha256: string; configSha256: string;
  scorerRevision: string;
}
```

RunIdentity使用源文件实际内容，不只哈希`dist/extension.js`转发器。不保存key明文或可离线猜解的key摘要。一个pair两臂必须共享语义输入，但工作区实例分离。`runIdentity`不匹配禁止resume；失败pair仍存在，诊断臂不影响主分母。

## T01/T10：真实宿主测试Helper

新 `tests/helpers/product-harness.ts` 从现 `tests/acceptance/controlled-host-compaction.test.ts` 提取真实createAgentSession/loader逻辑，不另造假的hook调用宿主。

```ts
export interface ProductHarness {
  prompt(text: string): Promise<void>;
  compact(): Promise<void>;
  rawEntries(): readonly unknown[];
  requests(): readonly unknown[];
  runToolTurn(name: string, args: Record<string, unknown>): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
}
export function createProductHarness(): Promise<ProductHarness>;
```

runToolTurn仅让受控Provider发出指定call，真实Pi调度工具，结果经过生产hook；它是集成测试，不是质量benchmark。Coding真实模型模式绝不能沿用固定正确答案。close必须清理临时HOME/进程/owner，测试不能依赖开发者配置。


## T06/T08/T12补充可执行签名

```ts
// Add to existing packages/core/src/retrieval/bounded.ts (T06).
export function sliceUtf8Page(input: {
  bytes: Uint8Array; byteOffset: number; maxBytes: number;
}): { bytes: Uint8Array; nextByteOffset: number | null };

// packages/benchmark/src/small-runner.ts (T08/T10/T12)
export interface Attempt {
  status: "completed" | "timeout" | "failed" | "not-run";
  success: boolean;
}
export interface PairAttempts {
  id: string; clusterId: string; repeat: number;
  B0: Attempt; B2: Attempt; B1?: Attempt; F0?: Attempt;
}
export function summarizeAttempts(rows: readonly PairAttempts[]): {
  primaryCompletePairs: number; plannedPairs: number;
  diagnosticFailures: number;
};
export function validateScenario(input: unknown): Scenario;
export function decideCanary(input: {
  integrityFailures: number;
  recoveryTested: number; recoveryPassed: number;
  criticalRegressions: number;
  completedPairs: number; plannedPairs: number;
  medianTaskInputDelta: number | null;
  medianWallTimeDelta: number | null;
}): "reject" | "inconclusive" | "keep-native" | "canary-experimental";
```

Scenario.sourceEntries是以上接口的必需字段。Oracle的sourceSha256须等于对应text的UTF-8 SHA256；需要历史角色恢复时，fixture通过生产输入/工具路径产生回执，不能凭role字符串创建authenticated identity。真实任务来源可以用外置只读trace文件替换此内嵌数组，但必须在manifest记录内容hash。

`decideCanary`优先级：integrityFailures>0或criticalRegressions>0返回reject；恢复tested<5或passed!=tested或completed<planned返回inconclusive；否则已知的总输入或总时长成对中位差<=-0.10且另一已知效率不回退超过0.10时，返回canary-experimental；其余keep-native。未知指标不替代0，不允许仅因为checkpoint很短进入canary。这个函数是保守工程门，不是统计优越性证明。


## T09/T11：环境和运行模式

```ts
// scripts/credential-broker.mjs: JavaScript export with the equivalent JSDoc types.
export function buildAgentEnvironment(
  parent: Readonly<Record<string, string | undefined>>, armHome: string
): Record<string, string>;
// apps/pi-context-runtime/src/extension.ts (T11)
export function resolveRuntimeMode(
  value: string | undefined
): "off" | "ingress" | "experimental-runtime";
```

buildAgentEnvironment只继承PATH、必要平台临时目录变量与明确新增的代理地址，不透传TOKEN/KEY/AUTH/COOKIE等凭据。返回HOME=armHome；未知环境变量默认不继承。此函数测试通过不证明文件系统/进程隔离，T09仍须实际隔离负例。

resolveRuntimeMode(undefined)=ingress；非法非空值抛CONFIG_ERROR；off不注册有副作用hook，ingress不得接管context/compaction；experimental-runtime必须显式指定。T11同时更新真实宿主helper显式选择experimental-runtime，避免默认值变化掩盖产品测试。

跨session的fork不按同名entry ID自动授权。T02的buildBranchView处理一个session的已认证父链；已支持的fork继承应继续经过现有host fork lineage校验，生成子session的显式来源关联，保留原始source cursor用于解密。未验证的跨session条目拒绝，不通过把workspace/session比较删掉实现兼容。至少增加“合法fork共享祖先”和“伪fork引用”两项集成测试；不新建全局跨会话搜索。


## T07：覆盖与统计最小公共函数

```ts
// packages/benchmark/src/scoring/recovery.ts
export interface RecoveryCaseResult {
  eligible: boolean;
  attempted: boolean;
  exactBytesMatch: boolean | null;
  wrongScopeDenied: boolean | null;
}
export function summarizeRecovery(rows: readonly RecoveryCaseResult[]): {
  eligible: number; attempted: number; passed: number;
  passRate: number | null; status: "not-tested" | "partial" | "passed" | "failed";
};
// packages/benchmark/src/statistics/paired-small.ts
export function summarizePairedSuccess(rows: readonly {
  clusterId: string; baseline: boolean; candidate: boolean;
}[], options: { bootstrapSamples: number; seed: number }): {
  pairs: number; clusters: number; meanDelta: number;
  discordance: { bothPass: number; baselineOnly: number; candidateOnly: number; bothFail: number };
  ci95: [number, number] | null;
};
```

恢复passed要求eligible+attempted+exactBytesMatch+wrongScopeDenied均true；eligible=0返回not-tested/null；未尝试的eligible不进passed且状态partial，已尝试但失败须返回failed。不能从是否含secret推断原件可恢复。

success空rows抛INVALID_SAMPLE；meanDelta按全部配对成功差平均。独立cluster均匀有放回bootstrap，抽中cluster带入它的全部重复；预注册固定seed/样本次数；少于2个独立cluster则ci95=null。报告同时保留cluster数量，不能把重复样本伪装成独立任务。固定伪随机算法及分位数规则纳入函数单测；没有有效cluster设计时区间只作描述而非显著性证明。
