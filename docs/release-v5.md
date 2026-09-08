# v5 release candidate

Package: `pi-context@5.0.0-dev.0` (`private: true`).
Tarball SHA256: `53dbdb0aa3580f50dabf808b395bab2051829f177f48c2da88f1d03c1ef4e2e7`.

Verified host: npm `@earendil-works/pi-coding-agent@0.85.1` gitHead `d981de12`. Design-pack source `9767ba2` was not installed (`hostIdentityMatch: false`).

```bash
nvm use v22.19.0
pnpm install
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

## Recommendation

From **this tarball's** `artifacts/v5-evaluation/report.json` (unspliced 8×2, elapsedMs 315212):

**observe** — both-pass **5/8**; hard C2 proven via `eval/live-c2.mjs` (`recoveryPathProven: true`); J05 in smoke did not call `pctx_history`. J03 B0 maven oracle blocked; J03 B2 failed atomicity; J04 both failed. No resource net-gain → not balanced. `twoPercentNiClaimAllowed: false`.

T17 ACK is `proposed → acked → committed` with native hash match. T18 semantic remains off.

G5 incomplete: no npm publish / push `main`.
