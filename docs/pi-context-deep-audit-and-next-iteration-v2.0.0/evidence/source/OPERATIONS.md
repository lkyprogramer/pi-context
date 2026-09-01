# Operations

Required GitHub checks are defined in `.github/workflows/required.yml`.

Required job ids:

- install-frozen
- format-lint
- package-boundaries
- build
- typecheck
- unit
- integration
- oracle-validation
- security-fast
- pi-contract-0-84-4
- packed-install-hermetic
- product-vertical
- recovery-crash
- w1-locked
- w2-boundary-smoke
- run-bundle-verify

Advisory/nightly workflows (`compatibility.yml`, `nightly.yml`, `live-benchmark.yml`) must not be merge-required.

Branch protection should enable those required contexts on `main`. Apply with repository admin rights:

```bash
node scripts/ci/verify-protection.mjs
```
