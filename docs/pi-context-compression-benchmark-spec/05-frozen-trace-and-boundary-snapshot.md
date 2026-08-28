# 冻结 Raw Trace 与 Boundary Snapshot

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. RawTrace 是唯一公共输入

`RawTrace` 必须在任何 Tool Result Reducer 和 Compaction 前捕获。每条记录有稳定 `entryId`、顺序、role、content hash、toolCallId、timestamp 和来源。

## 2. BoundarySnapshot

每个可评测压缩边界必须包含：

```text
Pi session JSONL + current leaf ID
agent active message projection
workspace filesystem snapshot or OCI image digest
git HEAD/index/worktree hashes
running-process policy and explicit side-effect ledger
model/provider/thinking/config
context token estimate and provider usage anchor
next hidden continuation task
oracle and forbidden actions
```

## 3. Snapshot 恢复

每个 Arm 在独立临时目录中恢复：

```text
runs/<runId>/<scenarioId>/<armId>/<replicate>/
  pi-home/
  workspace/
  runtime-store/
  provider-session/
  logs/
```

不得复用 SQLite、CAS writable head、Pi Session file 或 Provider conversation/session ID。

## 4. 可评测边界分类

- `pre-threshold`：尚未触发，用于测 proactive recall/ingress；
- `native-threshold`：Pi Native 将触发；
- `overflow-recovery`：模拟或真实 provider overflow；
- `semantic-boundary`：测试完成、任务切换、方案收敛；
- `branch-boundary`：tree/fork 前后；
- `single-huge-turn`：验证 split-turn 和 tool pair。

## 5. Full-context Oracle Arm

只有当相同 Executor Model 可容纳未压缩输入时才运行 Full-context Arm。若不适配窗口，使用：

1. 原轨迹中已验证成功的下一步作为行为 Oracle；或
2. 选择更早、仍可容纳的边界；

不得换用更强/更大窗口模型后仍宣称是同模型 paired continuation。
