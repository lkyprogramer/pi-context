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

From unspliced 8×2 `artifacts/v5-evaluation/report.json`:

**limited-trial**（文档个人 canary：「本环境有限样本可试用」）— closed-loop 8/8：J01–J04 与 J06–J08 双臂过 oracle；J05 为 C2 配对（B0 无 `pctx_history` 失败，B2 `recoveryPathProven`）。无完整相对 B0 的资源净收益账本 → **不是 balanced**。`twoPercentNiClaimAllowed: false`。

G5 incomplete：未 publish / 未 push `main`。
