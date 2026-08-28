# Error Codes

| Code | Boundary | Default |
|---|---|---|
| PCR_OWNER_ALREADY_CLAIMED | startup | blocked |
| PCR_KNOWN_CONTEXT_CONFLICT | startup | blocked/warn by profile |
| PCR_UNSUPPORTED_PI_VERSION | startup | blocked |
| PCR_CAPABILITY_MISSING | startup | blocked |
| PCR_KEY_UNAVAILABLE | startup/storage | blocked |
| PCR_STORAGE_NOT_READY | storage | read-only/blocked |
| PCR_RAW_CAPTURE_FAILED | tool_result | fail-closed or bounded emergency |
| PCR_DIRECTIVE_BUDGET_EXCEEDED | context | abort |
| PCR_UNREPAIRABLE_ACTIVE_TURN | context | abort/host compact |
| PCR_TOOL_PAIR_INVALID | context | abort |
| PCR_RETRIEVAL_SCOPE_DENIED | retrieval | deny |
| PCR_ACTION_AUTHORITY_MISSING | tool_call | block/approval |
| PCR_CANDIDATE_STALE | background | discard |
| PCR_HOST_COMPACTION_NOT_SHRINKING | compaction | reject/fallback |
| PCR_RECOVERY_DIVERGENCE | startup | quarantine |
