# T25 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t25.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T25/**`
- `blockers/T25-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/budget/**`
- `packages/runtime/src/token-calibration.ts`
- `tests/performance/token-accounting.test.ts`

## Necessity

The allowed directories cannot host the mandated RED file or export `TokenPricer` from package roots. Evidence logs live outside Allowed Files by protocol.

No live tokenizer download: T25 prices from full HostMessage block text with an injected route table. Production constructors require the route table; there is no default window/fake model.

## Interface and State Impact

- `@pcr/core` exports `createTokenPricer({ cursor, routes })` and `TokenPricer`.
- `@pcr/runtime` exports `createTokenCalibration({ cursor, routes })`.
- `effectiveInput` is `max(0, contextWindow - maxOutputTokens - providerReservedTokens)`.
- `priceMessage` counts complete block text, never a message-id fingerprint. Calibration density is per modelKey and resets on model switch.

## Alternatives rejected

- `suffixFingerprint(ids)` as estimatedTokens (F009).
- Reusing kernel `computeEffectiveInputBudget`'s `effectiveMaxInputTokens` override as the shipped v2 path.
- Defaulting a global 128k window in production constructors.
