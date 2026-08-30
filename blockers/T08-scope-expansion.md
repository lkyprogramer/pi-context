# T08 Scope Expansion Approval

## Requested Paths

- `packages/runtime/src/index.ts`
- `apps/pi-context-runtime/package.json`
- `package.json`
- `pnpm-lock.yaml`
- `tests/tasks/t08.test.ts`
- `artifacts/task-evidence/T08/**`
- `blockers/T08-scope-expansion.md`

## Necessity

T08 requires the registry to compile through the public `@pcr/runtime` export. The root test project therefore consumes that package by name. The production app composition root imports the same public barrel source (`packages/runtime/src/index.ts`) through a repository-relative path because T06's self-contained TypeScript pack compiles the repository source graph into one tarball; declaring `workspace:*` in the app manifest leaks that protocol into the tarball and makes a clean npm/Pi install fail with `EUNSUPPORTEDPROTOCOL`. The task protocol separately mandates the target test and evidence files but omits them from Allowed Files.

The audit plan also has no later task whose Allowed Files permit wiring the T09-T13 persistent storage and semantic services into `apps/pi-context-runtime/src/composition-root.ts`. T08 therefore delivers explicit, fail-closed identity and resources factory seams and advances F001; it does not claim that the missing downstream production ports already exist or that F001 is closed. The identity factory is supplied with T04's public `createRuntimeCursor` by the downstream acceptance test, avoiding a second identity algorithm inside T08.

The root test project declares the locked Pi 0.84.4 package and `@pcr/runtime` so the acceptance test resolves the actual public Pi `SessionManager` and the target test consumes the runtime package through its public export rather than private source paths.

## Interface Impact

`@pcr/runtime` publicly exports `PiSessionContext`, `RuntimeSessionRegistry`, and its factory/handle contracts. The app consumes that public barrel without adding an uninstallable workspace dependency and exposes a production composition constructor through the explicit `pi-context-runtime/composition-root` subpath. That constructor cannot be created without the T04 identity factory and a session resources factory. The stable default extension/pack entry does not export this incomplete future wiring surface.

## Alternatives Rejected

- Importing a private runtime implementation file would not prove the required downstream public contract; the app imports only the public barrel, and the target test separately compiles through the package name.
- Shipping `@pcr/runtime: workspace:*` in the app manifest was tested and rejected because clean npm/Pi installation fails before extension loading.
- A default in-memory or no-op resource factory would violate T08's production dependency rule.
- Wrapping the legacy fixed cursor/fake worker path would move F001 rather than advance it.
- Editing the signed audit package or silently broadening later tasks would invalidate the controller contract.

## Approval

Approved under the user's repository-wide goal to complete the referenced rearchitecture plan. This is a local-only expansion and does not authorize publication, push, deployment, or remote writes.
