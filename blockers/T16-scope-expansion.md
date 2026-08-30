# T16 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t16.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `artifacts/task-evidence/T16/**`
- `blockers/T16-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/directives/segment.ts`
- `packages/core/test/directives/segment.test.ts`

## Necessity

The two-file boundary cannot:

1. Host the task-mandated RED file `tests/tasks/t16.test.ts`.
2. Export `createClauseSegmenter` / `ClauseSpan` from `@pcr/core` so a downstream consumer compiles against the public interface.

Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `@pcr/core` exports `createClauseSegmenter`, `segmentClauses`, and `ClauseSpan`.
- Construction requires an explicit cursor. Missing cursor fails closed.
- Each clause records utf8ByteRange, utf16Range, and codePointRange over the original string. Offsets are not JS `match.index` aliases.

## Alternatives rejected

- Keeping kernel `explicitDirectiveSpans` as the production path: that is F004/F033 (marker-only, UTF-16 misnamed as byteRange).
- Segmenting without a bound cursor: the protocol requires scope denial tests; T17 will pass the user-turn cursor.
