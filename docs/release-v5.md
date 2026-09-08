# v5 release candidate

Package: `pi-context@5.0.0-dev.0` (`private: true`).
Tarball SHA256: `53dbdb0aa3580f50dabf808b395bab2051829f177f48c2da88f1d03c1ef4e2e7`.

Verified host: npm Pi 0.85.1 gitHead `d981de12` (design pack `9767ba2` not installed).

```bash
nvm use v22.19.0
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

## Recommendation

**observe** from unspliced 8×2 on this tarball (`artifacts/v5-evaluation/report.json`): both-pass **2/8** (J06, J08). J03/J04/J05 failed on both arms. J01/J02/J07 also failed this run (a later isolated J01 B2 passed — not folded back into ITT).

Hard C2: `eval/live-c2.mjs` on the same tarball is `recoveryPathProven: true`. J05 in the 8×2 did not call `pctx_history`.

`twoPercentNiClaimAllowed: false`. Not limited-trial (need 8 both-pass). Not balanced.
