# AI START HERE

## 当前决策

- 默认 Compactor：Pi Native
- PCR：保留 Ingress/CAS/Reducer/Retrieval；Checkpoint 仅 shadow/experimental
- Semantic Background：disabled
- Publication：false
- Release：blocked
- HEAD：以 `git rev-parse HEAD` 为准（不要复用本段里的历史 SHA）

W0–W4 **代码与闸门**已在本地 `main` 提交（未 push）。这不等于原文 Exit Gate 已达成。live 200K / overflow / 3-cycle / post-fix 100×3 **未观测**。Finding 全部保持 `open`。账本见 `findings/FINDINGS.md` 顶部。

## 第一组命令

```bash
git rev-parse HEAD
git status --short
pnpm install --frozen-lockfile
pnpm test:unit
pnpm test:integration
python3 scripts/taskctl.py verify-state
```

期望 HEAD 必须由当前工作副本记录。`taskctl verify-state` 对提交前 SHA 的 evidence 会 `stale-head`——这是已知治理债，不是 live 已过。

## 执行入口

1. 读 `findings/FINDINGS.md`（先读账本表，再读各 NF）；
2. 读 `plans/00-master-plan.md`；
3. 从 `tasks/TASK-INDEX.json` 选择依赖满足、文件不冲突的任务；
4. 按 `30-ai-agent-execution-protocol.md` 执行；
5. Controller 使用 Evidence v2 验证后才能 Done；**需要 live 的 Finding 不得用 hermetic 绿关闭**。

## 当前最高优先级

```text
产品：B1 vs B2 materializer 开关（新卡，允许改 extension）
Live：200K natural threshold（增量 persist）
Live：Provider overflow → compact → retry
Live：recursive ≥3 compaction
Eval：post-fix 100×3 on the same HEAD（禁止混合旧 300 对）
Corpus：真实脱敏轨迹，否则 corpus-v3 继续 fail-closed
```

不要把 fixture 写入 `benchmarks/corpus-v3/real-traces/` 来关 NF021。不要降低 keepRecent 来制造 threshold。不要 `publicationClaim=true`。
