# Security

- Critical and High findings cannot be waived.
- Packed artifacts must not contain test fixture secrets (`sk-t43-*`, `sk-t47-*`, `sk-live`, walkthrough keys).
- Backup archives are encrypted. `keys/*.key` are excluded from backup plaintext.
- Restore never overwrites a live workspace directory.
- GC is dry-run by default and requires a confirmation token that matches the inventory hash.
- Doctor output must not include raw secrets or absolute home paths.

## Report

If a release gate sees `securityCritical > 0` or `securityHigh > 0`, packaging stops (`PCR_SECURITY_BLOCKED`).
