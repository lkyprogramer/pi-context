# 合同

所有形状为规范，不是现有代码。字段名一经实现即冻结；S07 的 bundle 必须能脱离源码目录用这些字段复算 decision。

## plan（`review-matrix.json` → `manifest.plan`）

```jsonc
{
  "schemaVersion": 2,
  "repsPerCase": 3,
  "qualityIds": ["Q01","Q02","Q03","Q04","Q05","Q06","Q07","Q08"],
  "capabilityIds": ["C01","C02"],
  "regimeLanes": {
    "warm": { "ids": ["W-Q01","W-Q03","W-Q05","W-Q07"], "arms": ["native","balanced"] },
    "long": { "ids": ["X01"], "arms": ["native","balanced"] }
  },
  "guardIds": ["G01","G02"],
  "noFoldRegression": ["L01","L02","L03","L04","L05","L06"],
  "exactQuoteIds": ["Q05","X01"],
  "requiresFold": { "Q01": true, "...": true, "C02": false, "W-Q01": true, "X01": true },
  "expectedPairs": 24,
  "expectedCapabilities": 6,
  "expectedRegimePairs": { "warm": 12, "long": 3 },
  "plannedEpisodes": 84,
  "objective": {
    "primary": { "metric": "fresh-input", "minImprovement": 0.1 },
    "secondary": ["logical-input","wall-time","cacheRead","engine-prefill","native-compactions","requests"]
  },
  "window": { "triggerPercent": 60, "protectRecentBatches": 4, "minRemovedTokens": 4096 },
  "budget": {
    "episode": { "wallMs": 600000, "modelCalls": 24, "toolCalls": 48 },
    "episodeLong": { "wallMs": 900000, "modelCalls": 40, "toolCalls": 80 },
    "run": { "totalWallMs": 7200000, "totalModelCalls": 1500, "totalToolCalls": 2400 }
  },
  "order": [ { "episodeId": "review:Q01:native:r1", "caseId": "Q01", "arm": "native", "rep": 1, "kind": "quality", "lane": "Q", "status": "UNRUN" } ]
}
```

`kind ∈ {quality, capability, regime}`；`lane ∈ {Q, C, W, X}`。`order` 由 `buildReviewPlan()` 生成：同一 case 的 rep 内先 native 后 balanced，case 组顺序由 `--seed` 打乱。

## pair

```ts
type Pair = {
  caseId: string; rep: number; lane: "Q" | "W" | "X";
  nativePassed: boolean | null; candidatePassed: boolean | null;
  nativeQuote: boolean | null; candidateQuote: boolean | null;   // 仅 exactQuoteIds 内非 null
  foldRequired: boolean; foldApplied: boolean;
  criticalViolation: boolean;
  nativeMetric: Record<Metric, number | null>; candidateMetric: Record<Metric, number | null>;
  status: "complete" | "NOT_RUN" | "blocked" | "timeout" | "error";
};
type Metric = "fresh-input" | "logical-input" | "wall-time" | "cacheRead" | "engine-prefill" | "native-compactions" | "requests";
```

`criticalViolation` 保持第 7 轮定义：`protectedIntact === false || foldedErrorResults > 0 || status === "blocked" && /critical/`。

## objective

```ts
type Objective = {
  primary: { metric: "fresh-input"; minImprovement: 0.1; known: boolean; relativeChange: number | null; nativeSum: number | null; candidateSum: number | null; pairsUsed: number };
  secondary: Record<Metric, { known: boolean; relativeChange: number | null; nativeSum: number | null; candidateSum: number | null }>;
};
// relativeChange = candidateSum / nativeSum − 1；任一 pair 任一侧 null → known=false, relativeChange=null
// nativeSum === 0 → known=false
```

`objectiveFromPairs(pairs, plan.objective)` 为纯函数，位于 `eval/local/gate.mjs`；`report.mjs` CLI 与 `bundle.mjs.recomputeDecision` 都必须调用它而不是读 manifest 里的预置值。

## decision

```ts
type Decision = {
  decision: "blocked" | "inconclusive" | "review-needed" | "quality-qualified-cost-unknown" | "history-only" | "limited-balanced-trial";
  reason: string;
  discordant: Array<{ caseId: string; rep: number; kind: "candidate-fail-native-pass" | "candidate-pass-native-fail" | "shared-failure" | "quote-discordant" }>;
  counts: { b: number; c: number; shared: number; bByCase: Record<string, number> };
  attemptRates: { firstAttemptSuccess: number | null; finalAttemptSuccess: number | null };
  pairedSuccessDelta: number | null;
  objective: Objective;
  regimes: { warm?: RegimeSummary; long?: RegimeSummary };
  candidates: Array<{ candidate: string; evidence: string[]; status: "met" | "below-gate" }>;
  diagnosticOnly: boolean;   // dirty tree run → 强制 inconclusive
};
type RegimeSummary = { pairs: number; b: number; c: number; shared: number; objective: Objective; nativeCompactions: { native: number; candidate: number }; quoteFailures?: { native: number; candidate: number } };
```

`evaluateTrial(input)` 输入：`{ pairs, capabilities, objective, attempts, plan, regimes, diagnosticOnly }`。输出中 `decision` 字段值不得被 `report.md` 的散文改写；`report.md` 的 "## decision" 段由 `renderDecision(decision)` 生成。

## episode 增补字段

`result.oracle.quotedVerbatim: boolean | null`（Q05、X01 必填，其他 null）；`result.manifest.lane`；`result.requests[].normalized.freshInput` 已存在（R07），是主目标的唯一来源。

## broker hop（Darwin）

```jsonc
// <episode>/broker-hop.json
{ "kind": "darwin-sidecar-volume-network-none", "volume": "pctx-sock-1a2b", "sidecar": "pctx-b-1a2b", "socketPath": "/run/pctx/broker.sock", "agentNetwork": "none" }
```

`secure-preflight --canary` 输出增加 `agentEgress: false`（Darwin 与 Linux 都检测；`true` 即 BLOCKED）。

## `verbatimQuote`

```ts
verbatimQuote(parsed, { linePattern: string; sinceMs: number; sourceKind?: "isError" | "any" }): boolean | null
// sourceKind 默认 "isError"（H02 行为不变）；"any" 时取分支上首个匹配行的 toolResult（不限 isError）
// 返回 null：找不到源行；true：sinceMs 之后任一 assistant 文本含（空白折叠后）整行；false：其他
```

## cases.json 增补

- Q05：`"evidence": { "kind": "verbatim-quote", "sourceKind": "any", "linePattern": "idempotency broken: reservation ZX-731 replayed after callback\\." }`
- W-Q0x：`runner: "review"`, `lane: "W"`, `windowProfile: "w64k"`, `arms: ["native","balanced"]`, `reps: 3`, `fixture` 同基底 Q，`taskFile: eval/local/cases/W-Q0x/TASK.md`（首段要求 `cat` 两份指定文件），`seed: eval/local/seeds/review/W-Q0x.jsonl`, `reviewFixture: eval/local/review-fixtures/W-Q0x.json`（`seedUsagePercent: 45`, `padSource: "fixture-files"`）。
- X01：`runner: "review"`, `lane: "X"`, `windowProfile: "w64k"`, `arms: ["native","balanced"]`, `reps: 3`, `seed: null`, `logs: { "count": 12, "lines": 600, "marked": 7, "markLine": 410, "token": "FIRST-ERROR-MARKER" }`, `taskFile: eval/local/cases/X01/TASK.md`, `grader: { kind: "file-oracle", editable: ["marker.txt"], fileOracle: { file: "marker.txt", contains: "FIRST-ERROR-MARKER at build-07 line 410" } }`, `evidence: { kind: "verbatim-quote", sourceKind: "any", linePattern: "FIRST-ERROR-MARKER at build-07 line 410" }`, `budget: "episodeLong"`。

## `docs-decision-consistency`

`test/unit/docs-decision-consistency.test.ts` 读取 `artifacts/local-eval/review-final/report.json` 的 `decision.decision` 与 `manifest.runId`，断言 `README.md`、`HANDOFF.md`、`docs/OPERATIONS.md`、`docs/CONFIGURATION.md` 各至少一处以反引号包裹的同一 decision 字面量，且不含任何其他五值枚举字面量被描述为"当前交付决策"（用正则 `交付决策[：:].*\`(\w[\w-]*)\`` / `delivery decision is \*\*\`(\w[\w-]*)\`\*\*` 抓取）。`review-final` 缺失时该测试 `ctx.skip()` 并打印 BLOCKED。
