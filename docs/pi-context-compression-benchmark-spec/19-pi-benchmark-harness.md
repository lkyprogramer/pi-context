# Pi Benchmark Harness 集成

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 公开 API 原则

Benchmark Harness 不修改 Pi 源码，不导入 `src/` 私有路径。通过已发布 Pi Package、Extension Hooks、Session JSONL 和独立临时 Pi Home 运行。

## 2. Pi Native Arm

每个 Arm 使用临时安装的固定 Pi 版本。Pi Native Compaction 通过真实 threshold/manual/overflow 路径触发，捕获 `session_before_compact` preparation 和 `session_compact` 结果，但不替换其算法。

## 3. W1 Arm

RawTrace 重新回放；`tool_result` Hook 在写入前运行 W1 Capture/Reducer。不得从 A0 的已持久化压缩后 Session 派生 A1/A2。

## 4. W2 Arm

在同一 W1ShapedTrace 上，通过 PCR 的 `session_before_compact` provider 返回 deterministic candidate；`session_compact` 确认 Host Commit。

## 5. Snapshot/Session 克隆

Pi Session JSONL 是树结构。Harness 必须复制完整文件并固定 current leaf；禁止只复制 Active Messages 后丢失 branch/compaction metadata。

## 6. Hook 顺序检测

启动时记录已知 Extension 顺序与 output hash。发现另一个 `context`、`tool_result` 或 `session_before_compact` owner 时，该 Run 标记 `invalid-composition`，不得计入结果。

## 7. 最新基线

研究快照时 Pi main 为 `ccfe79ed238674f760c986e3a61493aab794000a`，Coding Agent 版本仍为 `0.84.3`。正式运行必须同时记录实际 npm tarball integrity、Git commit（若可得）与 Public API capability probe。
