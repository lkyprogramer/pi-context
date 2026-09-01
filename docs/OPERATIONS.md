# Operations

Required GitHub checks are defined in `.github/workflows/required.yml`.

Required job ids:

- install-frozen
- format-lint
- package-boundaries
- build
- typecheck
- unit
- contract
- acceptance
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

The aggregator job is `required-gate`. Compatibility's aggregator is `compatibility-required`.

`node scripts/ci/verify-protection.mjs` only checks that those job ids exist in `required.yml`. It does **not** read or apply GitHub Branch Protection.

Read-only API verify (fails closed when `required-gate` / `compatibility-required` are not configured):

```bash
node scripts/ci/github-protection.mjs verify
```

`apply` is **not implemented** in W0. It requires repository admin credentials and a later explicit task. Do not treat a YAML job-name parse or a throwing `--apply` stub as Branch Protection being enabled. NF025 stays open until a real API read shows those two contexts.

Current product claim policy:

- `default_compactor`: pi-native
- `publicationClaim`: false
- `npmPublish`: false
- distribution: internal `npm-pack` tarball (`private` / `UNLICENSED`)
