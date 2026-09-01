# Compatibility

Unsupported Pi versions are **not** implied to work.

| Lane | Version | CI |
|---|---|---|
| min | 0.84.4 | blocking |
| current | 0.84.4 | blocking |
| latest | advisory | non-blocking |

- Supported range: `>=0.84.4 <0.85.0`
- Audited source HEAD: `6c5c5b5ace3c14ea28535de9de2b95cc4fa40a31`
- Host: patched `@earendil-works/pi-coding-agent@0.84.4` (`apps/pi-context-runtime/package.json` `piHostContract`)
- Node: `22.19.0`, `24.18.1`, `26.5.1`
- Modes: `tui`, `rpc`, `print`

Private imports are forbidden:

- `@earendil-works/pi-coding-agent/src`
- `@earendil-works/pi-agent-core/src`
- `pi-coding-agent/dist/core/`
- `agent-loop`

Peer dependency `*` avoids installing a second Pi runtime. It does **not** mean future Pi versions are compatible. Compatibility is the lock file, CI lanes, and runtime probe.

`compatibility-required` is a GitHub check name. YAML job presence is not the same as Branch Protection being applied.
