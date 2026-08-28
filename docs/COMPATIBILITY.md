# Compatibility

Unsupported Pi versions are **not** implied to work.

| Lane | Version | CI |
|---|---|---|
| min | 0.84.3 | blocking |
| current | 0.84.3 | blocking |
| latest | advisory | non-blocking |

- Supported range: `>=0.84.3 <0.85.0`
- Baseline commit: `938109e7259068ff736dbba3bed14c81af25abbe`
- Node: `22.19.0`, `24.18.1`, `26.5.1`
- Modes: `tui`, `rpc`, `print`

Private imports are forbidden:

- `@earendil-works/pi-coding-agent/src`
- `@earendil-works/pi-agent-core/src`
- `pi-coding-agent/dist/core/`
- `agent-loop`

Peer dependency `*` avoids installing a second Pi runtime. It does **not** mean future Pi versions are compatible. Compatibility is the lock file, CI lanes, and runtime probe.
