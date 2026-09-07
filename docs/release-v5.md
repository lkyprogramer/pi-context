# v5 release candidate

Package: `pi-context@5.0.0-dev.0` (`private: true`).
Candidate commit: `d1c2b51a` (official `toolResult` mapping via `message.toolCallId`).
Tarball SHA256: `34152efe24ca2d8a9509705ec64f34942f66d3a15fe76d6872d6095a6a593ffd`.

Install (verified against official Pi 0.85.1 CLI — extracts to `dist/extension.js`):

```bash
nvm use v22.19.0
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

Recommendation is produced only from `artifacts/release-candidate/g0-g5-table.json` (history-only / observe; G3/G4 `not-run`). Semantic stage (T17/T18) is unsupported. Host npm gitHead `d981de12` ≠ stated source `9767ba2`.
