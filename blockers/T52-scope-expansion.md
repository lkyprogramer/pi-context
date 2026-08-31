# T52 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t52.test.ts`
- `artifacts/task-evidence/T52/**`
- `blockers/T52-scope-expansion.md`

Allowed Files remain:

- `apps/pi-context-runtime/**`
- `scripts/release/pack.mjs`
- `tests/release/clean-install.test.ts`

## Necessity

Mandated RED file cannot live in Allowed Files.

## Interface and State Impact

- `packCurrentSource()` / `installAndRunVerticalProbe()` default to the repository root so the T52 RED contract does not require T06's explicit `repoRoot`.
- `createReleasePacker({ repoRoot })` is fail-closed and returns `ReleasePackage { tarball, sha256, sbom, cleanInstallLog }`.
- Packed tarball is the T06 compiled bundle (self-contained `dist/`), not the jiti re-export of TS sources (F015/F031).
- Source package stays `private: true` (no npmjs publish); LICENSE + `pcrRelease` document tarball/`pi install` only (F016).

## Alternatives rejected

- Three-line fake factory as a packed-install stand-in.
- `npm pack` of the unbundled app `dist/extension.js` that re-exports `../src/extension.ts`.
- Flipping `private` and breaking the T06 pack-smoke receipt.
