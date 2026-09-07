# v5 release candidate

Package: `pi-context@5.0.0-dev.0` (`private: true`).
Tarball SHA256: `08db4066fc6a8e82039e7d3cabd42c31c1f878e67104c1f77bc0a21fd6060c08`.

Install (verified against official Pi 0.85.1 CLI — extracts to `dist/extension.js`):

```bash
nvm use v22.19.0
pnpm install
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

## Recommendation

From `artifacts/v5-evaluation/report.json` / `artifacts/release-candidate/g0-g5-table.json`:

**observe** — ITT 8 paired cases; both-pass 7/8 (J06 B0 and B2 failed the other-branch hint). No resource net-gain ledger, so **not balanced**. `twoPercentNiClaimAllowed` is false even if all 8 had passed.

Host npm gitHead `d981de12` ≠ stated source `9767ba2`. T17/T18 unsupported. J03 is a synthetic self-invocation fixture, not Spring Boot. No independent reviewer on this freeze. No npm publish / push `main`.
