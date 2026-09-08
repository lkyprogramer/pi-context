# 执行总计划（6.1）

先读根目录 [AI-START-HERE](../AI-START-HERE.md)。本轮是收敛：修 history 的安全与正确、删掉没有证据支撑的三块（checkpoint/staging/semantic 与 exposure ledger）、把 balanced 改成阈值触发的无损折叠，然后在 4090 现网模型上用真实 Pi 会话证明或否定它。

| 阶段 | 任务 | 阶段出口 |
|---|---|---|
| A 官方接线 | A01 | `pi -e dist/extension.js` 下 `/pctx status` 显示真实 profile/configHash/hostVersion；`session_compact` 读 `compactionEntry` |
| B history | B01 → B02 → B03 | scope 泄漏测试 0 命中；分页 cursor 不重复不遗漏；UTF-8 边界回读逐字；图片真实返回 |
| C 折叠 | C01 → C02 → C03 | `src/checkpoint` 不存在；派生暴露与保护集单测；阈值折叠 plan 冻结、失效、遥测 |
| D 真宿主 | D01 | `pnpm smoke`：官方 Pi + 受控 provider 下 observe 逐字节相同、balanced 折叠/回读/前缀稳定/compact 清空 |
| E 4090 验证 | E01 → E02 → E03 → E04 | `pnpm eval:local` 跑完 [scenarios](../testing/scenarios.json)，report.md 给出决策 |

**调度**：单 Agent 顺序 A01 → B01 → B02 → B03 → C01 → C02 → C03 → D01 → E01 → E02 → E03 → E04。E01 只依赖 A01，可在 B/C 期间由第二个 Agent 并行（它只写 `eval/local`）。同一个 `src/plugin.ts`/`src/adapter.ts`/`src/contracts.ts` 同一时间只能一个 Agent 写。不需要 worktree、taskctl 或证据平台。

**每任务纪律**：先写任务卡里的 RED 测试并看到行为断言失败；实现；`pnpm exec vitest run <testFile>` 绿；`pnpm typecheck`；只 `git add` 任务卡允许的文件；提交标题 `<type>(<taskId小写>): <实际功能>`；在 `docs/iterations/native-first-v6.md` 追加 5–10 行（任务、命令/exit、覆盖边界、剩余限制）。缺 Node/依赖/Docker/隧道是 `blocked-environment`，不是行为 RED，也不能 `skip` 混为通过。

**测试选择**（遵循仓库 AGENTS.md）：纯局部逻辑只跑单个测试文件；改 `src/contracts.ts` 或跨模块跑 `pnpm typecheck` + 相关 integration；改入口/打包/宿主边界跑 `test/host` 或 `test/packed`；全仓 `test:unit` 只在阶段末和 E04 前跑。

**Provider 费用**：本轮没有付费 Provider。E 阶段只用 4090 现网 `openclaw/Qwen3.8-27B-WORK`（不停 systemd unit，不改 4090 上任何配置），串行 episode，遵守 [runbook](../testing/01-runbook.md) 的预算。
