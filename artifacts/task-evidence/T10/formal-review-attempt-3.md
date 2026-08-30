# T10 formal review attempt 3

- Candidate: `1f10b3c823ec91f9fe8a05ee4971baef5bc96683`
- Tree: `c9a09da03d8060cebf6c6f2ac4f37c2a2e28add5`
- Profile: `reviewer`, requested `gpt-5.6-sol/high`, exact zero-write
- Verdict: `FAIL`

All storage, durability, scope, rotation and evidence findings were closed. One P1 type-integration issue remained: the candidate unnecessarily branded the legacy `ObservationProjection.rawBlobId`, while its existing kernel producer still returns `string`; runtime/T09 typed fixtures also used non-canonical blob literals, and the kernel package typecheck is a no-op.

Resolution: keep the legacy projection contract unchanged, retain branding on v2 durable/runtime contracts, migrate existing typed fixtures to canonical refs, and add a real targeted `tsc --noEmit` producer/port integration check.
