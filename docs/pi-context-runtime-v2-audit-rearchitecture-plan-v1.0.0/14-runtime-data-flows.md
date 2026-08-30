# Runtime 数据流

## User Input

```text
Pi input
→ capture exact raw turn
→ Pi expands skill/template
→ message_end links hostMessageId
→ clause segmentation
→ directive candidates
→ supersession resolver
→ FTS catalog
```

## Tool Result

```text
Pi tool_result
→ normalize actual event
→ raw bytes encrypted CAS + fsync
→ prepared Saga row
→ deterministic reducer
→ EvidenceRecord + FTS
→ return compact visible content
→ Pi message_end host commit
→ acknowledge Saga
```

## Context

```text
Pi context event
→ stable message codec
→ Runtime Snapshot transaction
→ actual model budget
→ active turn + directives + continuity + recall
→ deterministic materialization
→ View Receipt
→ full ordered Pi messages
```

## Compaction

```text
session_before_compact
→ snapshot by firstKept/source entries
→ build verified checkpoint
→ if soft reject: return undefined, Pi Native fallback
→ if ready: stage + return CompactionResult
→ session_compact: ack host entry
→ session_compact_failed: stale/recover
```
