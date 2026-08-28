# Install

Pi Context Runtime `0.1.0-alpha.1` is a Pi package. Do not publish it unless an explicit release action is taken.

## Requirements

- Node `22.19.0`, `24.18.1`, or `26.5.1` (see `compat/pi.lock.json`)
- Pi `@earendil-works/pi-coding-agent@0.84.3` (`>=0.84.3 <0.85.0`)

## Project install

```bash
pi install npm:pi-context-runtime@0.1.0-alpha.1
pi list
```

From this repository without publishing:

```bash
pi -e ./apps/pi-context-runtime/dist/extension.js
```

## Global-style / clean Pi home

Use a disposable `PI_HOME` (or equivalent host config dir). Install the packed tarball, then remove it. User data is not deleted on uninstall.

```bash
npm pack --pack-destination /tmp/pcr-release
# extract the tarball into $PI_HOME or the project node_modules path used by Pi
pi remove npm:pi-context-runtime
```

## Rollback

1. `pi remove npm:pi-context-runtime`
2. Restore a T47 workspace backup into a **new empty** directory if data must be rolled back.
3. Reinstall the previous tarball hash from the release manifest.

Uninstall never purges workspace data automatically.
