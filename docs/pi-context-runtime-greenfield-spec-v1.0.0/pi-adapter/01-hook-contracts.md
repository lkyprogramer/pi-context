# Hook Contracts

- `context`: request-local AgentMessage[] replacement。
- `tool_result`: post-execution/pre-persistence result projection。
- `tool_call`: action gate。
- `session_before_compact`: custom checkpoint provider。
- `session_compact`: host commit acknowledgment。
- `session_start/session_tree/session_shutdown`: lifecycle。

所有 handler 必须在顶层捕获异常，并将 Pi fail-open 行为转换为 PCR 明确 fallback。
