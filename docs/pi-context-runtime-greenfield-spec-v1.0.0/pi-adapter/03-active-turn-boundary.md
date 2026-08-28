# Active Turn Boundary

从尾部找到最近真实 user message，保留之后所有 assistant/toolResult。验证 toolResult 的 call ID 在 suffix 或保留的前置 assistant tool call 中存在。巨大 result 必须先 pointerize。
