# Pi Context Runtime v2 Master Implementation Plan

> **For agentic workers:** Execute tasks through `scripts/taskctl.py`; one fresh worker per Task is preferred. Every step uses checkbox tracking and evidence sealing.

**Goal:** Replace the current stub-integrated runtime with a source-backed, storage-connected Pi Context Runtime and a non-gameable live evaluation system.

**Architecture:** Pure deterministic Core is composed by a stateful RuntimeSession. Pi Adapter translates public Hook events only. Node Storage supplies SQLite/CAS/Saga. Benchmark package owns immutable traces, Oracle validation and paired closed-loop execution.

**Tech Stack:** Node 22.19+/24.18+, TypeScript 5.9, pnpm 10.15, Vitest, node:sqlite, Pi Coding Agent 0.84.3 public API.

**Spec:** `12-target-architecture.md`, `22-evaluation-v2.md`, `28-ai-agent-execution-protocol.md`.

## Global Constraints

- No compatibility with old internal APIs/schema/checkpoints.
- No hard-coded production cursor/head/model/budget.
- No app-to-sibling-src relative imports.
- No benchmark corpus change without benchmark major change.
- No release while any P0 finding or required CI is open.
- Semantic layer remains off until deterministic Gate passes.

| Wave | Tasks | Range |
|---|---:|---|
| W0 | 7 | T00–T06 |
| W1 | 9 | T07–T15 |
| W2 | 8 | T16–T23 |
| W3 | 10 | T24–T33 |
| W4 | 5 | T34–T38 |
| W5 | 12 | T39–T50 |
| W6 | 4 | T51–T54 |

## Critical Path

```text
T00→T01→T02→T03→T04/T05→T07/T08/T09/T10/T11
→ T12/T13/T15 → T16/T17/T18/T19/T20
→ T24/T25/T26/T27/T28 → T29/T30/T31/T32/T33
→ deterministic Gate
→ optional T34–T38
→ T39–T50 evaluation
→ T51–T54 release
```

## Wave exit policy

Every Wave must end in a vertical acceptance artifact. A set of passing isolated module tests is not a Wave exit.
