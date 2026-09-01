# B22 live Pi CAS read (unrun)

Hermetic coverage:

- `scoreExactRecovery` reads bytes, checks sha256/length, requires wrong-cursor scope denial.
- `fromExtension` + zero pointers is `n/a`, not recovery.
- `recoverExactLiveArm` reconstructs session cursor from JSONL (root→leaf) and reads `createEncryptedBlobStore`.

Not run: real Pi B1 compact + extension-written envelope on this HEAD. `pnpm vitest run tests/live-gate/exact-recovery.live.ts` is not collectable under exclusive `*.test.ts` lanes; GREEN uses `exact-recovery.live.test.ts`.

NF010 stays open until a live B1 arm reports `recoveryStatus=ok` with denominator > 0.
