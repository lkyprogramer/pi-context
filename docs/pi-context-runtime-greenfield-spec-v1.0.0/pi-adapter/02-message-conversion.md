# AgentMessage ↔ HostMessage

转换保持 timestamp、role、toolCallId、toolName、isError 和 content block。`custom` 只接受 PCR 自己的 marker；未知 custom 保留为 agent-derived。`compactionSummary/branchSummary` 作为 agent-derived user-role view，不自动变为 trusted fact。
