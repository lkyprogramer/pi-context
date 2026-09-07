# Superseded PCR runtime

The patched `@earendil-works/pi-coding-agent@0.84.4` workspace (`apps/pi-context-runtime`, `packages/*`, `patches/`) was **removed from this repository** in T25. It is not a parallel product.

- Unique installable entry: `pi.extensions` → `./dist/extension.js` on official Pi **0.85.1**
- The v5 packed tarball has no PCR ingress contract and no host patch
- User session files under Pi's native session directory are not migrated and not deleted
- Uninstalling the v5 plugin does not require a reverse migration library
- Historical PCR tests/scripts live under `archive/pcr-tests` and `archive/pcr-scripts`; they are not the default gate
- Live analysis reports stay in `artifacts/`; raw dumps were backed up under `artifacts/backups/` before this cut
