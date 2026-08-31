# F005/F013 related: native fallback

Soft compaction rejection returns `undefined` so Pi Native continues.

- `packages/pi-adapter/src/compaction-hook.ts` native-fallback → undefined
- `tests/acceptance/compaction-fallback.test.ts`
- `tests/tasks/t31.test.ts`
