# T27 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t27.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `artifacts/task-evidence/T27/**`
- `blockers/T27-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/materialization/materializer.ts`
- `packages/core/test/materialization/materializer.test.ts`

## Necessity

The allowed files cannot host the mandated RED file or export `createMaterializer` / `Materializer` from the package root. Evidence logs live outside Allowed Files by protocol.

T27 composes T25 (`TokenPricer`) and T26 (`SectionPlanner`, `CacheReceiptService`). Those ports are injected; the materializer does not open storage or invent a default snapshot.

## Interface and State Impact

- `@pcr/core` exports `createMaterializer({ cursor, pricer, planner, cache })`.
- `materialize(request, snapshot)` reads hard directives and continuity from `RuntimeSnapshot`, never from constructor constants.
- Active-turn cost is `TokenPricer.priceMessage` over exact suffix bodies. If pinned sections exceed `I_eff`, throw `PCR_UNREPAIRABLE_ACTIVE_TURN`.
- The returned `MaterializedView.messages` is one zone-ordered list (no positional stitch).

## Alternatives rejected

- Kernel `ContextMaterializer` with `{ directives: "keep" }` and `suffixFingerprint(ids)`.
- Default empty snapshot or in-memory cache inside the production constructor.
- Wiring Pi `transformMessages` stitch here (T28).
