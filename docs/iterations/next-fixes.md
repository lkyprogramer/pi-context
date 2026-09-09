# next-fixes (6.1 audit next-steps)

Baseline: `7478307ead72e849e9c619a913858afe8a06d38b`. Default profile stays observe. Fold defaults stay 60/40/4/4096/1024/120.

## R01

Changed: `package.json`, `.github/workflows/required.yml`, `.github/workflows/compatibility.yml`, `test/unit/ci-contract.test.ts`, `docs/iterations/next-fixes.md`

RED: `pnpm exec vitest run test/unit/ci-contract.test.ts --config vitest.config.ts` exit 1 — `scripts.check` was undefined; `required.yml` still called `scripts/ci/compile-runtime.mjs`, `tests/w1-gate`, and `pnpm test:unit`.

GREEN: same command exit 0 — 2 tests; `pnpm typecheck` exit 0.

Implemented: `pnpm check` = typecheck + default vitest + `compat:scan`. required has `check` (Node 22.19.0, pnpm 10.15, frozen install) and `stock-smoke` (`pnpm build && pnpm smoke`). compatibility is `workflow_dispatch` only on Node 24.18.1. No live eval in CI.

vitest exclude (historical, not moved this task):
- `test/integration/eval-runner.test.ts` — removed v5 B0–B3 runner
- `test/unit/report.test.ts` — removed v5 report surface
- `test/integration/java-cases.test.ts` — v5 Java pairing leftover

`publication.yml` still references deleted PCR release scripts; out of R01 file list, left untouched.

Not run: remote GitHub Actions on this HEAD (local only; last push was blocked by invalid gh token). `pnpm check` / `pnpm smoke` recorded in the R01 close command if executed.

## Remaining

R02–R10 not started.
