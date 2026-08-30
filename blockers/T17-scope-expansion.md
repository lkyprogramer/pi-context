# T17 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t17.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `artifacts/task-evidence/T17/**`
- `blockers/T17-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/directives/extract.ts`
- `packages/core/test/directives/extract.test.ts`

## Necessity

The two-file boundary cannot host the mandated RED file or export `extractDirectiveCandidates` from `@pcr/core`.

## Interface and State Impact

- `@pcr/core` exports `extractDirectiveCandidates`, `createDirectiveExtractor`, and `DirectiveCandidate`.
- Construction requires an explicit cursor. Quotes are full T16 clauses, not marker slices. Kind/polarity are preserved (not rewritten to must-not).

## Alternatives rejected

- Reusing kernel `explicitDirectiveSpans`: F004 (marker-only quotes) and F033 (UTF-16 as byteRange).
- Adapting polarity to must-not in this layer: that is F005.
