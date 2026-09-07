# v5 release candidate

Package: `pi-context@5.0.0-dev.0` (`private: true`).

Install (verified against official Pi 0.85.1 CLI — extracts to `dist/extension.js`):

```bash
nvm use v22.19.0
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

Recommendation is produced only from `artifacts/release-candidate/g0-g5-table.json`. Semantic stage (T17/T18) is unsupported.
