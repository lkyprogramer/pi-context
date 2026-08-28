# Semantic Proposal、Verifier 与 Deterministic Repair

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

限制 LLM 只提出结构化候选，使用证据、authority、时间、极性和行为门验证后才能发布。

## 2. 已冻结决策

- Semantic model 只能输出 Claim/Continuity proposal refs。
- 不向模型提供 secrets、hidden reasoning 或 unrestricted raw blobs。
- Verifier 失败先 deterministic repair，再 deterministic fallback。
- 同一模型不能以自评覆盖 deterministic failure。

## 3. Proposal

```ts
interface SemanticProposal {
  proposalId: string;
  sourceHead: string;
  claimMutations: ProposedClaimMutation[];
  continuityPatch: ProposedContinuityPatch;
  episodeNotes: ProposedEpisode[];
  citedEvidenceIds: string[];
}
```

## 4. Verification Ladder

1. schema/canonical decode；
2. candidate key/source head；
3. refs 存在且 scope 正确；
4. no new concrete entity/number/path without evidence；
5. polarity/time/supersession；
6. authority non-escalation；
7. outcome attestation；
8. hard directive coverage；
9. ledger/section budget；
10. contradiction and lifecycle barrier；
11. deterministic repair；
12. optional risk-only critic；
13. boundary-local shadow continuation（beta gate）。

## 5. Fallback

任何未修复 gap 返回 deterministic claim/continuity render；不提交自由摘要。Semantic failure 只降低质量增强，不影响容量安全。

## 6. 不变量

1. Verifier report 本身不含 raw evidence content。
2. Unsupported high-risk outcome 永远 reject。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `schemas/verifier-report.schema.json`
- `tasks/T36-verifier.md`
