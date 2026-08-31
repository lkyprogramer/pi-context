# Rollback drill

This is a documented drill, not an automatic data purge.

1. Stop new installs of the current tarball.
2. `pi remove npm:pi-context-runtime` (workspace data is retained).
3. Confirm `pi list` no longer shows `pi-context-runtime`.
4. Reinstall the previous tarball whose SHA-256 is `ReleaseManifest.packageHash` of the prior release (not npmjs).
5. Restore a workspace backup only into a **new empty** directory if data must move.
6. Record the drill log hash into the next `ReleaseManifest.rollbackDrillHash`.

Do not `rm -rf` workspace stores as part of uninstall.
