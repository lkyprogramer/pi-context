# T43 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t43.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T43/**`
- `blockers/T43-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/arms/w2.ts`
- `tests/live/w2-paired.test.ts`

## Necessity

The mandated RED file and `@pcr/benchmark` barrel cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createW2ArmRunner({ corpusId, manifest, cursor, cases, shaper, native, pcr })` is fail-closed.
- Every arm shapes the RawTrace once through the shared W1 ingress (`ingress: "w1"`) and then compactors see that shaped view (F025).
- B0 is Pi Native; B1 is PCR deterministic checkpoint with identity materializer; B2 enables PCR materializer. `shapedTraceHash` / source span / retained tail are identical.
- The runner copies T39 `lockedTestHash` and does not rewrite corpus cases.

## Alternatives rejected

- Feeding Pi Native the unreduced raw dump while PCR sees a scrubbed checkpoint.
- Deriving B1/B2 from a B0 native session.
- Mutating locked holdout text to manufacture a token delta.
