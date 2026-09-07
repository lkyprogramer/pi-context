# v5 release candidate

Package: `pi-context@5.0.0-dev.0` (`private: true`).

Verified host: official npm `@earendil-works/pi-coding-agent@0.85.1` **gitHead `d981de12`**.
Design-pack stated source `9767ba2` was **not** installed (`hostIdentityMatch: false`). Do not substitute a git checkout.

Install:

```bash
nvm use v22.19.0
pnpm install
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

## Recommendation

**observe** (T24): ITT 8 paired cases; both-pass 6/8. J03 Spring B2 passed / B0 failed. J05 C2: compact did not leak; B0 failed; B2 `pctx_history` proven. J06 uses `SessionManager.branch` (no workspace HINT). `twoPercentNiClaimAllowed` is false. No resource ledger → not balanced.

T17 has a unit-tested staging state machine; it is not crash-restore against native CompactionEntry yet.
T18 stays **off**; `experimental-semantic` does not inject a model summary (native compact still owns the path).

Independent review: `artifacts/v5-tasks/T26/independent-review.md` (must-fix items recorded; J05 history instrument tightened after review). No npm publish / push `main`.
