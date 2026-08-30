# W0 Plan

## Exit Condition

Clean CI installs, package graph compiles, real Pi contracts and actual tarball smoke run.

| Task | Deliverable | Depends on |
|---|---|---|
| [T00](../tasks/T00-freeze-audit-baseline-and-immutable-evidence.md) | Freeze audit baseline and immutable evidence | — |
| [T01](../tasks/T01-repair-lockfile-and-required-ci.md) | Repair lockfile and required CI | T00 |
| [T02](../tasks/T02-create-destructive-v2-repository-skeleton.md) | Create destructive v2 repository skeleton | T01 |
| [T03](../tasks/T03-canonical-contracts-and-generated-schemas.md) | Canonical contracts and generated schemas | T02 |
| [T04](../tasks/T04-stable-cursor-and-identity-primitives.md) | Stable cursor and identity primitives | T03 |
| [T05](../tasks/T05-pi-0-84-3-public-api-contract-harness.md) | Pi 0.84.3 public API contract harness | T03 |
| [T06](../tasks/T06-real-npm-pack-and-clean-pi-install-harness.md) | Real npm pack and clean Pi install harness | T01, T02, T05 |

## Parallelism

Only Tasks whose `dependsOn` are committed and whose Allowed Files do not overlap may run concurrently. Integration Tasks at the end of the Wave are serial reviewer gates.
