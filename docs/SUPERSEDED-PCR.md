# Superseded PCR runtime

The patched `@earendil-works/pi-coding-agent@0.84.4` runtime under `apps/pi-context-runtime` and `packages/` is **superseded** by the v5 native-first plugin in `src/extension.ts`.

- Unique installable entry: `pi.extensions` → `./dist/extension.js`
- No PCR ingress contract and no host patch on the v5 packed tarball
- User session files are not migrated and not deleted
- Historical PCR tests are archive material and must not block removing the patch
