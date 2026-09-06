# Security

- Critical and High findings cannot be waived.
- Packed artifacts must not contain test fixture secrets (`sk-t43-*`, `sk-t47-*`, `sk-live`, walkthrough keys).
- Backup archives are encrypted. `keys/*.key` are excluded from backup plaintext.
- Restore never overwrites a live workspace directory.
- GC is dry-run by default and requires a confirmation token that matches the inventory hash.
- Doctor output must not include raw secrets or absolute home paths.

## Eval isolation

- Parent processes may read local Provider config. Agent/tool subprocesses receive `buildAgentEnvironment()` only: `HOME` is the arm directory, plus PATH/temp/locale and an explicit loopback broker URL. `TOKEN`/`KEY`/`AUTH`/`COOKIE` values are not inherited.
- Do not copy `~/.pi/agent/auth.json` or `models.json` with secrets into an arm. Arm `models.json` may only point at `http://127.0.0.1` broker URLs.
- Environment stripping is not a sandbox. If the agent process can still read the host auth path, tools-enabled live is blocked (`isolation-unproven`). A key present in the parent does not prove isolation.
- Controlled no-key / `PCR_LIVE` unset runs do not need the broker.
- Keys that already entered session, SQLite, or raw live logs should be rotated and those files kept local/read-restricted. Do not delete user logs from this repo and do not commit replacements that contain secrets.

## Report

If a release gate sees `securityCritical > 0` or `securityHigh > 0`, packaging stops (`PCR_SECURITY_BLOCKED`).
