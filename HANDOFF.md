# HANDOFF

## 当前任务

PCR v2 T00–T54 已全部 `committed`。计划 `findings.json` 中 F001–F038 已全部 `findingctl close`（26 P0 + 12 P1）。

本仓库当前没有未完成的 Task。不要再 claim T14–T54。不要自行 push / publish / deploy。

## 已完成

### Controller

- T00–T54 均为 `committed` / owner `grok-root`（T00–T11 更早）。
- T54 任务卡 SHA：`802973cc652b76e05aece8bfde5cb62e585e5fd1`。
- 其后产品/评测/finding 收口在 HEAD `4b08d38f6185deb5720a94904c3f8dc6932d176f`（tree `9b560af92474d726c07a8b90e3d3c371fa13ba6c`），领先 `origin/main`。

### 产品接线（T54 之后）

- `tool_result` 写入与 user-turn 同一套 SQLite/FTS/CAS；`context_search`/`context_read`/`context_recall` 在 execute 时 `resolveTools`。
- 产品 context hook 用派生 cursor + T27 materializer；compaction 记录 admitted evidence pointers。
- 后台 worker `markPrepared` 会 `persistBackgroundCandidate` 到 SQLite `background_candidate`。

### Finding 台账

- `python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/findingctl.py list`：空。
- 证据在 `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/findings/evidence/`。

### 已观察验证（非全量 Gate）

- 产品路径：`tests/acceptance/product-runtime-path.test.ts` 2/2。
- W1/W2 合成 Gate、kernel capture/materializer、message-conversion、t31/t37 在 P0/P1 收口时通过。
- 未在 HEAD 上重跑全量 791 串行 Gate。远端 CI 未在本 SHA 上跑（未 push）。

## 当前状态 / 卡点

- 无实现卡点。工作区代码已提交。
- `docs/.../artifacts/task-evidence/T12–T54/` 是 taskctl bind（`commit.txt` / `root-evidence.sha256` / `evidence.json`），与仓库根 `artifacts/task-evidence/` 双份。
- 评审政策：Grok 只读 `reviewer` 子代理；不跟文档里的 Codex Sol/high 档位。

## 下一步计划

1. 若要发布：在干净树上 `node scripts/release/pack.mjs`，设 `PCR_RELEASE_TARBALL` + `PCR_RELEASE_GATE_BUNDLE` 再跑 `node release/manifest.mjs`。`npmPublish` 仍为 false。
2. 若要远端绿：用户明确授权后再 `git push`；看 `compatibility-required`。
3. Live 200k / overflow 仍走 `pnpm test:live` 与 nightly `environment: live`，不在默认 `pnpm test`。

## 绝对不要再踩的坑

- 不要 claim T14–T54；controller 已全部 committed。
- 不要提交 `artifacts/runs/w1-synthetic/report.json` 的 Gate 噪声。冻回：`hookP95Ms = 33.45799554999991`，`reportDigest = 01713017df65fc44a9c81deca93d17c88088569a852ca02ceb80e11e96266a1d`。
- 不要把 `findingctl` 的 close 写进计划 `findings.json` 之外的平行账本当正式关闭。
- 不要改 `tests/w1-gate/corpus.ts` 而不 bump `tests/w1-gate/corpus.lock.json` major。
- 不要给 assistant 补零 `usage`；不要把未知工具标成 `trusted-tool`。
- 不要自行 push / npm publish。

## 关键文件 / 命令 / 验证

```bash
export NVM_DIR=/Users/luo/.nvm
. /usr/local/opt/nvm/nvm.sh
nvm use v22.19.0

python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/findingctl.py list
python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/taskctl.py next
pnpm vitest run tests/acceptance/product-runtime-path.test.ts
```

- 产品入口：`apps/pi-context-runtime/src/extension.ts`、`composition-root.ts`
- 台账：`docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/findings/findings.json`

## 给下一会话的第一步

```bash
cd /Users/luo/Documents/github/pi-context
git rev-parse HEAD
python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/findingctl.py list
python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/taskctl.py next
```

确认 `list` 为空、`next` 为 `none` 后，只做用户新指定的工作。
