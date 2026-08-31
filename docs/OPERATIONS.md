# Operations

Commands are available without calling an LLM.

| Command | Purpose |
|---|---|
| `/context` / `/context-doctor` | Status and readiness |
| `/context-recover` | Verify and repair local receipts |
| `/context-export` | Encrypted workspace backup |
| `/context-gc` | Unreferenced blob GC (default dry-run) |
| `/context-rotate-key` | Dual-key rotation with crash resume |
| `/context-compact` | Request settled host convergence |

## Backup / restore

1. `createWorkspaceBackup` checkpoints the store, hashes workspace files, and writes an encrypted archive.
2. Restore only into a new empty directory.
3. Every manifest hash is verified before the restore is marked `verified`.

## GC

1. `planWorkspaceGc` lists unreferenced blobs and a confirmation token.
2. `commitWorkspaceGc` refuses a mismatched token and refuses an inventory that changed.

## Key rotation

Rotation writes `keys/rotation.json` (not included in backups). A crash leaves the key ring in `dual`; rerunning the same rotate call resumes remaining blobs.

## Release / rollback

1. Publish only from a clean git tree via `node release/manifest.mjs` (hashes tarball, compat locks, T49 gate evidence, rollback drill).
2. Gate bundles are content-addressed (`createGateEngine.writeImmutableBundle`); do not treat gitignored live `report.json` as the release artifact.
3. Rollback: `release/rollback-drill.md`. Confirm `ReleaseManifest.rollbackDrillHash` matches the drill text.
