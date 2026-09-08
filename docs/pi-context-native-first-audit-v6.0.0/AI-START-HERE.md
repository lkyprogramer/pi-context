# AI 自主执行入口（6.1）

你在修改仓库 `/Users/luo/Documents/github/pi-context` 的 `v5/native-first` 代码，宿主是官方 Pi 0.85.1（全局安装），模型是用户 4090 上的现网 `openclaw/Qwen3.8-27B-WORK`。先核对 `git rev-parse HEAD` 是否从 `79c1ead5` 演进；若已变化，按符号而不是旧行号定位。遵守仓库 `AGENTS.md`（开发路径：先改代码，再用最窄测试证明；不要给普通改动套发布审计流程）。

## 0. Preflight（每次会话开始，5 分钟）

```bash
cd /Users/luo/Documents/github/pi-context
node --version && pnpm --version && pi --version        # v22.19.x / 0.85.1
git status --short | head; git rev-parse HEAD
pnpm install --frozen-lockfile && pnpm typecheck
python3 docs/pi-context-native-first-audit-v6.0.0/scripts/validate_bundle.py   # 本包自检
```

进入 E 阶段前额外：`bash docs/pi-context-native-first-audit-v6.0.0/testing/harness/ensure-tunnel.sh`（期望 `model=openclaw/Qwen3.8-27B-WORK n_ctx=262144 ok=True`），`docker version`。

## 1. 读什么

[design/00-target](design/00-target.md)、[design/01-contracts](design/01-contracts.md)、[design/02-fold-algorithm](design/02-fold-algorithm.md)、[audit/03-findings](audit/03-findings.md)、[audit/07-local-stack](audit/07-local-stack.md)、[audit/08-feedback-reconciliation](audit/08-feedback-reconciliation.md)（哪些外部建议被拒绝及原因，避免重新引入 pin/checkpoint/逐请求重规划）、[audit/09-codex-context-management](audit/09-codex-context-management.md)（6.2 候选二、三的来源；6.1 内不实现）。任务卡在 [tasks/](tasks/README.md)，顺序 A01 → B01 → B02 → B03 → C01 → C02 → C03 → D01 → E01 → E02 → E03 → E04；E01 只依赖 A01，可并行。

## 2. 每个任务怎么做

1. 打开任务卡，只改"文件边界"里的文件；要改别的文件，先在卡里加一行说明再改。
2. 写卡里的 RED 测试，运行，确认失败原因是**行为/合同未实现**（缺依赖、缺 Docker、缺隧道是 `blocked-environment`，去修环境，不算 RED）。
3. 实现；运行卡里列出的测试；`pnpm typecheck`。改到 `src/contracts.ts` 时同步更新所有调用方，不允许两处定义同名类型。
4. `git add <卡里的文件>`；`git commit -m "<type>(<taskId>): <功能>"`；在 `docs/iterations/native-first-v6.md` 追加：

```text
Task: A01
Commit: <git rev-parse HEAD 的输出，提交后读取>
Changed: <文件>
RED: <命令> exit <n> — <失败断言>
GREEN: <命令> exit 0 — <测试数>
Host/model: pi 0.85.1 / not-run | openclaw/Qwen3.8-27B-WORK via 127.0.0.1:18343
Remaining: <具体限制>
```

5. 阶段末跑阶段出口（[tasks/README](tasks/README.md) 表格）。

## 3. 红线

- 不 `skip`、不放宽断言、不删负例、不把 unknown 记 0。
- 不改 Pi 内核、不 fork、不引入 `patchedDependencies`。
- 不在 4090 上改任何文件、不停 unit、不开评测容器；只通过隧道用现网。
- 不把 NGINX token、SSH 口令写入任何文件；`eval/local/seeds/*.secret` 与 `artifacts/local-eval/` 不进 git。
- 不 push、不发布、不打 tag（用户另行授权）。
- E03 前不消耗 4090 跑矩阵；E01 允许一次 native smoke episode，E02 允许一次容器 smoke episode。
- 看到某 case 结果后不调 fold 参数重跑并只报后一次；调参 = 新 runId 并列报告。

## 4. 完成定义

12 张卡全部 GREEN；`pnpm smoke` 绿；`artifacts/local-eval/<runId>/report.md` 存在且 `decision:` 行是 `observe-only` 或 `limited-balanced-trial`（`inconclusive` 要补跑）；README/CONFIGURATION/OPERATIONS/HANDOFF 只描述 6.1；tarball 与 sha256 记录在 iterations。若决策是 `observe-only`，这仍是完整交付——不要为了让 balanced 通过而改题、改门或改参数。
