# Current HEAD CI Evidence Summary

## Required run 33722504775

Failed jobs: `typecheck`, `packed-install-hermetic`, `run-bundle-verify`, aggregate `required-gate`.

## Compatibility run 33722504732

All ten cells failed at `typecheck`; downstream unit/acceptance/contract were skipped.

## Strict compile diagnostics

```text
composition-root.ts(1278,11) TS2352 Event -> ExtensionContext invalid cast
composition-root.ts(1317,28) TS7006 workspaceId implicit any
composition-root.ts(1324,28) TS7006 workspaceId implicit any
composition-root.ts(1420,27) TS7006 input implicit any
composition-root.ts(1431,25) TS7006 input implicit any
composition-root.ts(1436,29) TS7006 cursor implicit any
composition-root.ts(1441,32) TS7006 cursor implicit any
extension.ts(439,37/61/82) TS2339 RuntimeToolCtx has no cwd
economics.ts(58,7) TS2322 unknown not assignable to scalar
```

Packed suite: 4 files failed, 6 tests failed, 3 passed, 9 skipped. Failures arise before tarball install because runtime compile fails.
