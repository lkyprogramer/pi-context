# Install

Pi Context Runtime `0.1.0-alpha.1` is distributed as a **local npm-pack tarball** for `pi install`. It is `private` / `UNLICENSED`: do not `npm publish`.

## Requirements

- Node `22.19.0` or `24.18.1` (required); `26.5.1` is advisory (`compat/toolchain.lock.json`)
- Pi `@earendil-works/pi-coding-agent@0.84.4` (`compat/pi.lock.json`)
- pnpm `10.15.0`

## Build the tarball from this repository

```bash
node scripts/release/pack.mjs
```

That writes a compiled self-contained tarball, CycloneDX SBOM, and clean-install log. The SHA-256 of the tarball is `ReleaseManifest.packageHash`.

## Project install

```bash
pi install ./path/to/pi-context-runtime-0.1.0-alpha.1.tgz
pi list
```

From this repository without packing (development only; not the release artifact):

```bash
pi -e ./apps/pi-context-runtime/dist/extension.js
```

## Global-style / clean Pi home

Use a disposable Pi home. Install the packed tarball, then remove it. User data is not deleted on uninstall.

```bash
node scripts/release/pack.mjs
# install the printed tarball path into the Pi home / project
pi remove npm:pi-context-runtime
```

## Rollback

Follow `release/rollback-drill.md`. Uninstall never purges workspace data automatically. Reinstall the previous tarball hash from `release/manifest.json`.
