# HANDOFF

## 当前任务

继续完成 `/Users/luo/Documents/github/pi-context/docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0` 规定的 T00–T54 改造、测试、证据、Reviewer Gate 与 controller 状态闭环。

当前直接任务不是重新实现 T12，而是：

1. 对已冻结的 T12 候选 `4d964773b593723a033348abb3b10f17b44274da` 补做一次最终 Sol/high 只读评审；
2. 只有 Reviewer 明确 `PASS` 后，才通过 controller 记录 T12 commit、绑定根 evidence digest、seal/verify；
3. 随即进入 T13 `Real Pi tool_result ingress`，之后按高吞吐依赖顺序继续 T14–T54。

固定环境：

- 仓库：`/Users/luo/Documents/github/pi-context`
- Pi 最新源码真源：`/Users/luo/Documents/github/pi`
- Node：`v22.19.0`
- pnpm：`10.15.0`
- Pi CLI：`0.84.4`
- 测试模型：`openclaw/Qwen3.8-27B-WORK`
- 模型配置已观察：`contextWindow=200192`、`maxTokens=16384`
- 不允许自行 push、publish、deploy、release 或写远程系统。

## 已完成

### Controller / commit 进度

- T00–T11 已 committed：
  - T00 `c7c3a38`
  - T01 `56c351d`
  - T02 `435276c`
  - T03 `21b49fe`
  - T04 `ade6f09`
  - T05 `1bc87ed`
  - T06 `1b44ce4`
  - T07 `db188c2`
  - T08 `7b25d8a`
  - T09 `2b4a7f3`
  - T10 `7365f4a`
  - T11 `a5dfb16`
- T12 当前候选 commit：`4d964773b593723a033348abb3b10f17b44274da`
- T12 tree：`ae87620d5e062f2e6e642a6e739313a639ddc889`
- T12 parent：`a5dfb163a9819a440aa89b30ca5d22e40954613a`

### T12 已实现的真实能力

- 真实 UTF-8 用户原文先写 encrypted CAS，再写共享 SQLite user-turn ledger。
- Pi 0.84.4 受控 patch 提供稳定 `inputId`、JSON-safe ingress sidecar、`input_result`、真实 `SessionMessageEntry.ingressMetadata`。
- 直接 `prompt`、`steer`、`followUp`、RPC 与 TUI compaction queue 进入同一 ingress 路径，并保留正确 source class。
- 关联扫描使用完整 `SessionManager.getEntries()` 和 sidecar 自身的真实 entry ID；不依赖数组邻接、FIFO、文本 sentinel 或伪 ID。
- copied fork history 通过 origin session 校验排除。
- host message ID 在 workspace/session 范围唯一。
- handled/rejected/queue-cleared 路径具有 durable terminal；失败后不会继续误链。
- storage master key 使用显式 lease，provider copy 与 working copy 在成功/异常路径均 zeroize。
- 唯一 packaged product entry 已连接真实 AgentSession、SQLite、CAS、key provider 和 user-turn service。
- stock Pi 0.84.4 在扩展加载期因缺少 `PCR_INGRESS_METADATA_CONTRACT` fail-fast；可发布的自包含 patched host 明确留给 T52。
- stock-host probe 已改为先解析 pnpm package symlink，再复制到临时目录反向应用 patch，并校验源 host digest 未变化。

### 最后一轮修复

针对上一位正式 Reviewer 的 2 个 P1、1 个 P2，已完成：

- streaming prompt 缺少 `streamingBehavior`、model/auth/compaction 等可预判 preflight 现在发生在 durable capture 前。
- capture 后、host message/queue 接管前的错误会发出严格 `input_result rejected` + `preflight-failure` terminal，再传播错误。
- 直接 `steer`/`followUp` 被底层 host queue 拒绝时，会回滚本地 sidecar/queue 状态并 durable terminalize receipt。
- `input_result` terminal handler 不再被 ExtensionRunner 静默吞错。
- `clearQueue()` 在所有 `queue-cleared` terminal 成功前不清 Pi queue；terminal 持久化失败时 `clearQueue()` reject，pending queue 保留以便重试。
- 新增真实 AgentSession 回归：
  - streaming preflight 不发生 capture；
  - queue terminal storage failure 时 clear reject 且 queue/receipt 保留；
  - direct steer host queue 拒绝时 receipt durable terminal、无 user entry。
- 新增 immutable `artifacts/task-evidence/T12/frozen-install.log`，记录最终 patch hash、物化 pnpm root、public type digest、runtime marker 与 exit code。

### 已观察验证

- T12 narrow：`tests/tasks/t12.test.ts`，2/2 PASS。
- T12 targeted：
  - `@pcr/pi-adapter` typecheck PASS；
  - `pi-context-runtime` typecheck PASS；
  - `tests/compat/pi-version-contract.test.ts`、`tests/acceptance/user-input-flow.test.ts`、`tests/acceptance/packed-install.test.ts` 合计 16/16 PASS。
- 最终 repository Gate：86 files、447 tests 全部 PASS。
- 最终 acceptance：3 files、20 tests 全部 PASS。
- package boundary：PASS。
- frozen install：PASS，最终 patch SHA-256 为 `2d89fec86b8f4e74c6d5199bc026f5747f4d057baeacd11b88edd097e7d0a636`。
- materialized package JSON SHA-256：`3cbf1bd8fa6766123d98078995016f9894e24e17309050b729a6bd95444868e5`。
- public types SHA-256：`923da1f859c247e0c23b4d10dbf71ad69bb36a26b103d9509ae4994c9fc00032`。
- runtime marker：`pcr-ingress-metadata-v1`。
- `artifacts/task-evidence/T12/evidence.json` 当前登记 74 个文件；本次只读复核所有 digest 匹配，`bad=[]`。
- `git diff --check` 在候选提交前已通过。

### T13 预读结果

- T13 文档：`docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/tasks/T13-real-pi-tool-result-ingress.md`。
- 当前 `packages/pi-adapter/src/tool-result-hook.ts` 仍是明确的 fake：固定 operation/workspace/session/toolCall/toolName/args/isError，并可默认 fake blob/saga。
- `packages/runtime/src/ports.ts` 已有 `ToolObservation`、`ProjectedToolResult`、`ToolResultPort`。
- `packages/runtime/src/runtime-session.ts` 已把 `ingestToolResult()` 转发给 port。
- `packages/kernel/src/ingress/raw-capture.ts`、`ReducerRegistry`、`defaultPointerReducer`、`projectObservation()` 已存在，可作为 T13 服务实现基础；T14 再交付完整 production reducers。
- 本地 Pi 真源 `853a80d26c90a14c1886f0ebb8ffaae133ca2185`（`v0.84.4-1-g853a80d26`）中：
  - `packages/coding-agent/src/core/extensions/types.ts` 定义真实 `ToolResultEvent` 字段：`toolCallId/toolName/input/content/details/isError/usage`；
  - `packages/coding-agent/src/core/extensions/runner.ts:927` 的 `emitToolResult()` 按扩展加载顺序链式应用 `content/details/isError/usage` patch；
  - 现有 upstream runner 会记录并吞掉普通 `tool_result` handler exception，T13 必须按文档的 integrity hard-stop 语义显式处理，不能假设 throw 会自动传给调用方。
- 已用 Exa 检索官方 `earendil-works/pi` extension 文档确认相同 middleware 语义；后续优先读本地 Pi 源码，只有本地源码/官方仓库缺事实时再用 Exa。

## 当前状态 / 卡点

- Git HEAD 已冻结在 `4d964773b593723a033348abb3b10f17b44274da`，tracked worktree clean。
- 当前 `git status --short` 只有用户提供的未跟踪目录：
  - `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/`
- 写入本 HANDOFF 后会另外出现未跟踪 `HANDOFF.md`；这是用户明确要求的交接文件，不属于 T12 候选 commit。
- Controller 当前仍为：
  - T12：`state=claimed`、`owner=codex-root`、`commit=null`
  - T13：`state=blocked`
- `taskctl.py next` 当前会显示 `T13`，原因是它跳过 `claimed` 的 T12；这不代表 T12 已闭合。
- 最后派发的正式 Reviewer `/root/t12_final_readonly_review_5` 被用户的会话中断打断，状态为 `interrupted`，没有最终 PASS/FAIL。绝不能把中断视为 PASS。
- `/tmp/pi-context-t12-review-allocation-4.json` 仍写着 `ACTIVE`，但实际 reviewer 已 interrupted；下一会话应创建新的 allocation 或先明确把旧 allocation 当作 stale，不能声称它仍在运行。
- 仍需重点审计一个未裁决风险：多条 queued receipt 的 `clearQueue()` 逐条 terminalize；若前一条成功、后一条失败，是否会留下“已 handled receipt 仍在保留队列中”的部分成功状态。上一 reviewer 被明确要求检查此点，但未返回结论。下一 reviewer 必须给出裁决；如成立，应先补原子 batch terminal 或安全的部分成功队列收缩，再重新 Gate。

## 下一步计划

### 1. 只补 T12 最终只读 Reviewer Gate

- 不修改代码、不跑 build/test/install。
- 对 immutable `4d964773...` / `ae87620d...` 派发一个 `reviewer / gpt-5.6-sol / high / exact zero-write` reviewer。
- Reviewer 重点：
  - preflight 是否全部在 capture 前；
  - capture 后到 host ownership 前是否都有 durable rejected terminal；
  - direct steer/followUp queue failure 是否正确回滚；
  - `clearQueue()` terminal failure 是否传播并保留可继续投递的 pending queue；
  - 多 receipt 部分成功问题；
  - frozen install/evidence 是否真实绑定最终候选。
- 只接受明确 `PASS` 且无 P0–P3 actionable finding。

### 2. Reviewer PASS 后闭合 controller

建议顺序：

```bash
cd /Users/luo/Documents/github/pi-context

# 先确认 immutable candidate 未漂移
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --short

# 根 evidence digest
shasum -a 256 artifacts/task-evidence/T12/evidence.json

# 记录 commit；它会创建 docs 内的 T12 controller evidence 目录/commit.txt
python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/taskctl.py record-commit T12 HEAD

# 用 apply_patch 创建：
# docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/artifacts/task-evidence/T12/root-evidence.sha256
# 内容格式参考 T00–T11，绑定上一步根 evidence SHA-256。

python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/taskctl.py seal-evidence T12
python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/taskctl.py verify-evidence T12
python3 docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/scripts/taskctl.py next
```

预期：T12 controller 状态变为 committed；T13 成为真实可 claim 的下一任务。

### 3. T13 高吞吐实现顺序

1. `check-ready T13`、claim、保存 preflight。
2. 先写 RED：`tests/tasks/t13.test.ts` 与真实 `tests/acceptance/tool-result-flow.test.ts`，必须使用真实 Pi event shape/ExtensionRunner 或真实 AgentSession tool path，不能只调用 fake host。
3. 新建 `packages/runtime/src/observation-service.ts`：所有 stateful dependency 显式注入；顺序必须为 raw bytes encrypted CAS durable → saga/receipt → reducer/projected visible result。
4. 重写 `packages/pi-adapter/src/tool-result-hook.ts`：映射真实 Pi 字段，保留 tool pairing、`details/isError/usage` 语义；禁止默认常量、fake blob、fake saga。
5. 将 T13 接到唯一 product entry；若超出 Allowed Files，先一次性更新 `blockers/T13-scope-expansion.md`，不要零散申请。
6. 开发期只跑 T13 target + touched-package typecheck；代码冻结后一次 narrow、一次 affected acceptance、一次文档要求的 repository Gate、一个 Reviewer。

### 4. 后续主路径

为尽快形成纵向结果，按以下顺序推进：

```text
T13 → T14 → T15 → T20 → T23
T16 → T17 → T18 → T19 → T22 → T21
T24 → T25 → T26 → T27 → T28
T29 → T30 → T31 → T32 → T33
T34 → T35 → T36 → T37 → T38
T39 → T40 → T41 → T42/T43/T44/T46 → T45 → T47 → T48 → T49 → T50
T51 → T52 → T53 → T54
```

每个任务只保留文档强制的 RED/GREEN、一次候选全量 Gate、一个只读 Reviewer、atomic commit 与 evidence/controller 闭环。

## 绝对不要再踩的坑

- 不要因为 `taskctl.py next` 显示 T13 就跳过 T12；先看 `.pcr/task-status.json` 的真实状态。
- 不要把 interrupted reviewer 当作 PASS；必须取得新的明确终审结论。
- 不要在每个小改后运行全仓回归。开发期只跑目标测试；代码冻结后只跑一次全量 Gate。
- 不要同时启动多个重复 Reviewer。每个 immutable 候选只用一个 Sol/high reviewer。
- 不要依赖固定的 `~/.nvm/.../pi` 路径；仓库验证应通过 frozen dependency 或 hermetic fixture。
- 不要让 stock-host probe 对 pnpm package symlink 直接执行 reverse patch；必须 `realpathSync` 后复制到临时目录，并校验源 digest。
- 不要直接编辑 `node_modules` 作为最终实现。Pi 改动必须通过 `pnpm patch`/`patch-commit` 生成版本绑定 patch。
- `pnpm patch-commit` 可能重新生成 nested patch 的空白问题；必须执行 `git diff --check`。`package.json` inner diff 可改为 zero-context hunk，避免 outer diff 的 `space before tab`。
- Pi patch hash 变化后必须同步：
  - `pnpm-lock.yaml`
  - `compat/pi.lock.json`
  - `apps/pi-context-runtime/package.json`
  - `artifacts/task-evidence/T12/correlation-contract.json`
  - frozen-install evidence
- `pnpm check:all` 会重写 `artifacts/runs/w1-synthetic/report.json` 的 timing/digest。不要提交该噪声；恢复冻结值：
  - `hookP95Ms = 33.45799554999991`
  - `reportDigest = 01713017df65fc44a9c81deca93d17c88088569a852ca02ceb80e11e96266a1d`
- 不要 stage、commit、删除或改写用户提供的未跟踪审计目录。
- 不要用 install smoke、synthetic W1/W2 或离线 fake 结果宣称 live quality、publication 或 release readiness。
- 不要在确定性任务无必要地调用 live 模型；只有任务验收明确要求 live 时才用固定 Qwen 模型。
- 不要读取、输出或记录 `models.json` 中的凭据；只使用已确认的 model ID/context/maxTokens 元数据。
- 不要自行 push、publish、deploy、release 或写远程系统。

## 关键文件 / 命令 / 验证

### 核心文档

- `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/plans/00-master-implementation-plan.md`
- `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/28-ai-agent-execution-protocol.md`
- `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/tasks/T12-exact-user-input-ledger-and-pi-correlation.md`
- `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/tasks/T13-real-pi-tool-result-ingress.md`
- `docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/.pcr/task-status.json`

### T12 实现与证据

- `patches/@earendil-works__pi-coding-agent@0.84.4.patch`
- `packages/pi-adapter/src/user-input-hook.ts`
- `packages/runtime/src/user-turn-service.ts`
- `packages/storage-node/src/user-turn-store.ts`
- `packages/storage-node/src/blob/key-provider.ts`
- `packages/storage-node/src/blob/store.ts`
- `apps/pi-context-runtime/src/composition-root.ts`
- `scripts/pack-smoke.mjs`
- `tests/acceptance/user-input-flow.test.ts`
- `tests/acceptance/packed-install.test.ts`
- `tests/compat/pi-version-contract.test.ts`
- `artifacts/task-evidence/T12/evidence.json`
- `artifacts/task-evidence/T12/frozen-install.log`
- `artifacts/task-evidence/T12/targeted.log`
- `artifacts/task-evidence/T12/full-gate.log`
- `blockers/T12-scope-expansion.md`

### 必须使用的 shell 前缀

```bash
export NVM_DIR=/Users/luo/.nvm
. /usr/local/opt/nvm/nvm.sh
nvm use v22.19.0
```

### 已运行且观察通过的最终 Gate 命令

```bash
set -o pipefail
{ pnpm check:all && pnpm vitest run tests/acceptance --passWithNoTests && node scripts/check-package-boundaries.mjs; } \
  2>&1 | tee artifacts/task-evidence/T12/full-gate.log
```

结果：86/86 test files、447/447 tests、acceptance 20/20、boundaries ok。

### Reviewer 调度约束

- 正式 review：`reviewer / gpt-5.6-sol / high / exact zero-write`。
- `python3 ~/.codex/agents/validate_dispatch_profiles.py` 当前会因未安装的 `lazycodex-*` 第三方 profile 返回非零；这些 profile 不在本波 allocation 中，按 AGENTS 规则不阻塞合规 reviewer。
- 每次实际 reviewer 仍需用新的 allocation manifest 通过：

```bash
python3 ~/.codex/agents/validate_dispatch_allocation.py <manifest>
python3 ~/.codex/agents/validate_dispatch_allocation.py <manifest> --require-active-attestation
```

## 给下一会话的第一步

先执行以下只读核验，不要先跑测试或改代码：

```bash
cd /Users/luo/Documents/github/pi-context
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --short
node -e 'const s=require("./docs/pi-context-runtime-v2-audit-rearchitecture-plan-v1.0.0/.pcr/task-status.json"); console.log(s.tasks.T12, s.tasks.T13)'
```

若仍为 HEAD `4d964773b593723a033348abb3b10f17b44274da`、tree `ae87620d5e062f2e6e642a6e739313a639ddc889`，且 tracked tree clean，则立即创建新的 reviewer allocation，对该 immutable candidate 补做一次 Sol/high exact-zero-write 最终评审；不要复用或声称 `/root/t12_final_readonly_review_5` 已完成。
