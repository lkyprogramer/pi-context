# B24 real B0/B1/B2/F0 (live Provider unrun)

Shipped:

- Per-arm independent Pi home/workspace clones (`createIsolatedArmHomes`).
- Shared cwd is `PCR_ARM_ISOLATE_SHARED_CWD` / tools-unsafe.
- Live launch plan drops `--no-tools`; F0 skips compact; B1/B2 load the extension.
- Sequential latin-square order is wired in `paired-w2-live.ts`.

Not run: `pnpm benchmark:w2:live-smoke` still needs a live Pi/Provider. `w5.ts` string stubs are unchanged (not in B24 allowed files). Live B1 and B2 share the product extension until a later allowed-files task adds an identity/pcr switch (`b1-b2-product-switch-blocker.md`). NF013 stays open.
