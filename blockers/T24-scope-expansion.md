# T24 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t24.test.ts`
- `packages/pi-adapter/src/index.ts`
- `packages/pi-adapter/package.json`
- `artifacts/task-evidence/T24/**`
- `blockers/T24-scope-expansion.md`

Allowed Files remain:

- `packages/pi-adapter/src/message-codec.ts`
- `packages/pi-adapter/test/message-codec.test.ts`

## Necessity

The allowed files cannot host the mandated RED file or export `createMessageCodec` / `PiMessageEnvelope` from the package root. Evidence logs live outside Allowed Files by protocol.

T24 does not replace `message-conversion.ts`. That module still contains `pi_${index}` and zero usage; the lossless envelope is the new public path. Composition-root cutover is T28.

## Interface and State Impact

- `@pcr/pi-adapter` exports `createMessageCodec({ cursor })` and `PiMessageEnvelope`.
- `hostMessageId` is a content/entry/toolCall hash, never `pi_${index}`.
- Opaque non-text blocks are stored on the envelope, not stitched by array slot.
- Assistant `usage` is preserved from raw, including `undefined`. No zero-fill.

## Alternatives rejected

- Patching `toHostMessages` in place: would mix T05 conversion tests that still assert zero usage.
- Using message array index as identity.
- Defaulting missing usage to zeros (F035).
