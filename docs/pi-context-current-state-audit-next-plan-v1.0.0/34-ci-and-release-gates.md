# CI 与 Release Gate v3

## Fast required checks

```text
install-frozen
format-lint
package-boundaries
build
typecheck
unit
integration
oracle-validation
security-fast
```

## Required acceptance

```text
pi-contract-0.84.4
packed-install-hermetic
product-vertical
recovery-crash
w1-locked
w2-boundary-smoke
run-bundle-verify
```

## Protected/nightly

```text
macOS/Linux Node matrix
real provider smoke
natural-threshold
overflow
recursive-long-horizon
performance-cache
security-fuzz
```

## 发布前

- current commit all required green；
- branch protection active；
- tarball self-contained；
- no user-home credential dependency；
- SPDX license/policy clear；
- SBOM/checksum/compat/rollback；
- immutable Gate bundle hash in manifest；
- publicationClaim derived, never hand-written true。
