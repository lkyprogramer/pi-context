# Pi Adapter 集成

## 固定兼容基线

首版支持 `@earendil-works/pi-coding-agent >=0.84.3 <0.85.0`，只使用公开 exports。每次 Pi minor 升级由 contract matrix 验证。

## Hook 映射

| Pi Hook | Runtime Method | 失败语义 |
|---|---|---|
| `input` | `ingestUserInput` prepare | hard storage error 时 abort，不吞 user input |
| `message_end` user | link user turn | orphan 进入 recovery queue |
| `tool_result` | `ingestToolResult` | integrity failure hard-stop；reducer failure可返回原文但保留 raw receipt |
| `context` | `materialize` | hard failure abort+safe diagnostic；soft failure pass-through |
| `session_before_compact` | `prepareCompaction` | soft reject让 Pi Native继续；hard integrity cancel+abort |
| `session_compact` | `acknowledgeCompaction` | 幂等补提交 |
| `session_start/tree/shutdown/model_select` | lifecycle | invalidate/recover/close |
| `agent_settled` | background prepare | 不阻塞 turn |

## 禁止 positional stitch

Adapter 必须保留完整 Pi message envelope，包括 thinking/toolCall/details/usage；Kernel 通过 envelope IDs 选择和排序，最终 codec 一次性输出完整数组。
