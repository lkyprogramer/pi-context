# W6 Plan

## Exit Condition

Clean package install, compatibility matrix and rollback drill pass; all P0 closed.

| Task | Deliverable | Depends on |
|---|---|---|
| [T51](../tasks/T51-end-to-end-deterministic-mvp-acceptance.md) | End-to-end deterministic MVP acceptance | T23, T28, T31, T32, T49 |
| [T52](../tasks/T52-production-package-build-and-clean-install.md) | Production package build and clean install | T06, T51 |
| [T53](../tasks/T53-pi-node-os-compatibility-matrix.md) | Pi/Node/OS compatibility matrix | T05, T52 |
| [T54](../tasks/T54-release-rollback-and-finding-closure.md) | Release, rollback and finding closure | T49, T52, T53 |

## Parallelism

Only Tasks whose `dependsOn` are committed and whose Allowed Files do not overlap may run concurrently. Integration Tasks at the end of the Wave are serial reviewer gates.
