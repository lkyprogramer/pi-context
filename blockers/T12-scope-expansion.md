# T12 Scope Expansion Approval

## Requested Paths

- `packages/contracts/src/v2.ts`
- `packages/contracts/schema-definitions.mjs`
- `packages/contracts/test/types.test.ts`
- `package.json`
- `schemas/user-turn-record.schema.json`
- `packages/runtime/src/index.ts`
- `packages/runtime/src/ports.ts`
- `packages/runtime/package.json`
- `packages/runtime/test/runtime-session.test.ts`
- `packages/pi-adapter/src/index.ts`
- `packages/pi-adapter/package.json`
- `packages/pi-adapter/src/contracts/pi-0844.ts`
- `patches/@earendil-works__pi-coding-agent@0.84.4.patch`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `packages/storage-node/src/index.ts`
- `packages/storage-node/src/blob/key-provider.ts`
- `packages/storage-node/src/blob/contracts.ts`
- `packages/storage-node/src/blob/store.ts`
- `packages/storage-node/src/schema/migrations.ts`
- `packages/storage-node/src/user-turn-store.ts`
- `packages/storage-node/src/saga-store.ts`
- `packages/storage-node/src/sqlite-store.ts`
- `packages/storage-node/test/user-turn-store.test.ts`
- `packages/storage-node/test/blob-store.test.ts`
- `packages/storage-node/test/saga-store.test.ts`
- `packages/storage-node/package.json`
- `tests/tasks/t07.test.ts`
- `tests/tasks/t08.test.ts`
- `tests/tasks/t12.test.ts`
- `tests/tasks/t06.test.ts`
- `tests/tasks/t10.test.ts`
- `tests/tasks/t11.test.ts`
- `tests/acceptance/session-registry.test.ts`
- `apps/pi-context-runtime/src/extension.ts`
- `apps/pi-context-runtime/src/composition-root.ts`
- `apps/pi-context-runtime/src/doctor.ts`
- `apps/pi-context-runtime/src/commands/operations.ts`
- `apps/pi-context-runtime/package.json`
- `compat/pi.lock.json`
- `scripts/install-pi-version.mjs`
- `tests/compat/pi-version-contract.test.ts`
- `tests/compat/provider-payload-probe.test.ts`
- `tests/release/package-artifact.test.ts`
- `tests/live-gate/paired-w2-live.ts`
- `.github/workflows/compatibility.yml`
- `reference/ci-matrix.yml`
- `tests/e2e/pi-factory-entry.test.ts`
- `tests/e2e/packed-install.test.ts`
- `tests/e2e/jiti-candidate-load.test.ts`
- `tests/e2e/key-rotation-v2-boundary.test.ts`
- `apps/pi-context-runtime/test/package-runtime.test.ts`
- `tests/tasks/t05.test.ts`
- `tests/live-gate/pi-resolve.ts`
- `scripts/pack-smoke.mjs`
- `artifacts/task-evidence/T12/**`
- `blockers/T12-scope-expansion.md`

## Necessity

The three-file boundary cannot publish the required package-root service, separate a provisional input receipt from the final host-linked `UserTurnRecord`, persist the ledger in the owned T09 SQLite database, or make the feature reachable from the only packaged Pi entry. Pi 0.84.4 also exposes neither an opaque ingress sidecar nor a host entry ID in `input` or `message_end`. A first candidate encoded the receipt in user-visible text and inferred the host entry from a neighbouring custom marker. Formal review proved that a later extension can transform or handle that text, direct `AgentSession.steer()`/`followUp()` bypass `input`, and an append-only multi-branch session makes neighbour inference ambiguous.

T12 therefore uses a version-bound pnpm patch for Pi 0.84.4. The patch carries namespaced, JSON-safe ingress metadata as a SessionMessageEntry sidecar, keeps it outside `AgentMessage` and provider payloads, routes direct steer/follow-up through the same input dispatch, and reports handled dispatches for durable abandonment. The adapter can then scan all session entries and link a receipt directly to the entry that contains it. The task also appends immutable migrations, reuses the package-private shared SQLite capability introduced by T11, adds a production key provider, and wires the hook through the single packaged composition entry. The runtime, adapter and storage package roots and their typecheck commands must include the new public contracts. Existing T07/T08 typed fixtures follow the corrected receipt contract.

Final review additionally proved that a stock 0.84.4 peer cannot express the required patch and would otherwise load the extension before failing on its first input. The patch now exports a runtime capability marker through Pi's loader-provided host module; the product imports that marker and therefore fails during extension loading on stock 0.84.4. The private T12 package declares the exact patch hash and its T52 distribution boundary. Packed acceptance uses the repository's frozen patched Pi, drives a real AgentSession through the installed tarball, verifies the SessionEntry/SQLite/CAS link and provider isolation, and separately proves stock 0.84.4 rejection. A publishable self-contained host distribution is not claimed here and remains the explicit T52 deliverable.

The next immutable review found four remaining terminal-state gaps: hard capture failures were reported as handled, TUI compaction queues lost their authenticated-user source, `clearQueue()` discarded captured inputs without a durable terminal, and the stock-host acceptance depended on a machine-specific Pi path. The patched host now emits `input_result rejected` and rethrows the original capture error, preserves `interactive` at every TUI compaction queue call site, asynchronously terminates every cleared queue receipt with `queue-cleared`, and builds the stock-host probe hermetically from the repository dependency. The probe resolves pnpm's package symlink before copying and verifies the source-host digest after reversing the patch, so it cannot mutate the installed patched host.

The final reviewer then identified two narrower capture-to-terminal windows. Predictable prompt checks now complete before `_dispatchInput()`, while failures after capture and before host ownership emit a strict `preflight-failure` terminal. Direct `steer` and `followUp` roll back local sidecars if the host queue rejects the message. `input_result` terminal handlers now propagate failure, and `clearQueue()` does not mutate Pi queues until every durable `queue-cleared` terminal succeeds. A frozen-install evidence log binds the final patch digest, materialized pnpm root, public type digest and runtime capability marker.

A later review found that sequential `queue-cleared` terminals were not atomic: the first receipt could become `handled` while its message stayed in the live agent queue if a later persist failed. `clearQueue()` now drops each successfully terminalized message from sidecar maps, UI arrays and the live agent queue immediately, retaining only unterminalized receipts. An AgentSession acceptance test covers first-success/later-fail plus non-delivery of the handled receipt.

The same review found that the local key provider returned a temporary master-key copy which the blob store copied again without destroying the provider-owned bytes. The storage contract now returns explicit one-shot key leases with mandatory `destroy()`. The blob store destroys both the provider lease and its own working copy on success and failure; storage and compatibility fixtures were updated to use the same ownership contract.

## Interface and State Impact

- `UserInputReceipt` becomes the provisional durable CAS/ledger receipt and no longer pretends that the future host-linked turn already exists.
- `UserTurnRecord.hostMessageId` becomes required; its stable `userTurnId` is derived only after the real Pi session entry ID is observed.
- Pi `extension` input is preserved as `agent-derived`; interactive and RPC inputs remain authenticated and untrusted respectively.
- `user_turn_ledger` stores full cursor scope, exact raw SHA-256, canonical BlobRef, UTF-8 byte length, source class, capture time, explicit pending/handled/linked disposition, optional final host entry and revision.
- The Pi 0.84.4 patch transports the receipt only as an entry sidecar. Later text transforms cannot remove it, handled inputs are reported without creating a user entry, and direct steer/follow-up use the same ingress path. Runtime reconciliation reads `SessionManager.getEntries()` and links the sidecar-bearing user entry's own ID; it does not use array position, active-branch adjacency, FIFO, text hashing or invented event fields.
- Host entry ownership is unique across a workspace/session, independent of the capture cursor's leaf, lineage or model.
- The packaged production entry owns one workspace SQLite/CAS/key lifecycle and creates cursor-scoped user-turn services from real Pi context. Missing or invalid production key material fails closed.

## Alternatives Rejected

- The legacy adapter reads fields absent from Pi 0.84.4 and falls back to fixed session `s1`.
- In-memory FIFO alone cannot recover across restart and is not authoritative provenance.
- Hashing only text merges two legitimate identical inputs.
- Treating `message.timestamp` as a host entry ID does not bind to Pi's persisted session identity.
- Text sentinels are observable and mutable by later extensions and can leak into JSONL or provider input.
- A custom marker adjacent to a future user entry is not authoritative in Pi's multi-branch append-only topology.
- A separate SQLite opener would violate T09's single-writer ownership.

## Approval

Approved under the user's repository-wide implementation goal. This remains local-only and does not authorize push, deployment, publication or remote writes.
