# Compatibility

This plugin requires **patched** `@earendil-works/pi-coding-agent@0.84.4` with the ingress-metadata contract `pcr-ingress-metadata-v1`. Stock / unmodified Pi is unsupported. This is not a Posthorse host fork and does not claim stock-Pi plug-and-play.

| Lane | Version | CI |
|---|---|---|
| min | 0.84.4 | same as current; not a separate matrix axis |
| current | 0.84.4 | blocking |
| latest | advisory | non-blocking |

- Supported range: exactly patched `0.84.4` (`>=0.84.4 <0.85.0` does **not** include stock 0.84.4)
- Audited source HEAD: `6c5c5b5ace3c14ea28535de9de2b95cc4fa40a31`
- Host: patched `@earendil-works/pi-coding-agent@0.84.4` (`apps/pi-context-runtime/package.json` `piHostContract`, patch `aafdfb29c4ce78146bd96cabb48d0e3cef032fd81cc17ee6acbc85c6bea584c5`)
- Node: `22.19.0` (primary), `24.18.1` (blocking), `26.5.1` (advisory / unverified for new versions)
- Modes: `tui`, `rpc`, `print`

Private imports are forbidden:

- `@earendil-works/pi-coding-agent/src`
- `@earendil-works/pi-agent-core/src`
- `pi-coding-agent/dist/core/`
- `agent-loop`

Peer dependency `*` avoids installing a second Pi runtime. It does **not** mean future Pi versions are compatible. Compatibility is the lock file, CI lanes, and runtime probe.

`compatibility-required` is a GitHub check name. YAML job presence is not the same as Branch Protection being applied. GitHub protection verify is advisory and must report unprotected repositories instead of greening product jobs.
