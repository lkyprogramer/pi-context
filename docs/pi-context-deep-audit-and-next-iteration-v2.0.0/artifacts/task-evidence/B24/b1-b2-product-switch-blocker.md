# B24 blocker — live B1 vs B2 product switch

B24 allowed files cannot change `apps/pi-context-runtime`. The shipped extension always `createMaterializer()` and does not read `PCR_EVAL_MATERIALIZER`.

Live launch plan therefore:

- B0: no `-e`, native compact
- B1 and B2: same `-e extension.js` + compact; env `PCR_EVAL_MATERIALIZER=identity|pcr` is a contract for a later product task
- F0: no compact

Component runner `createW2ArmRunner` still distinguishes B1 `materializer=identity` vs B2 `materializer=pcr`. That is not a live Provider proof.

NF013 stays open. Do not invent an identity compact path inside the benchmark package.
