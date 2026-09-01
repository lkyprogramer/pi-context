# AI START HERE

## 当前决策

- 默认 Compactor：Pi Native
- PCR：保留 Ingress/CAS/Reducer/Retrieval；Checkpoint 仅 shadow/experimental
- Semantic Background：disabled
- Publication：false
- Release：blocked

## 第一组命令

```bash
git rev-parse HEAD
git status --short
pnpm install --frozen-lockfile
pnpm test:unit
pnpm test:integration
python3 scripts/taskctl.py verify-state
```

期望 HEAD 必须由当前工作副本记录，不能硬编码复用本报告的 SHA。

## 执行入口

1. 读 `findings/FINDINGS.md`；
2. 读 `plans/00-master-plan.md`；
3. 从 `tasks/TASK-INDEX.json` 选择依赖满足、文件不冲突的任务；
4. 按 `30-ai-agent-execution-protocol.md` 执行；
5. Controller 使用 Evidence v2 验证后才能 Done。

## 当前最高优先级

```text
B01 Compatibility CI
B03/B04 Evidence Truth
B08 RuntimeSession Ownership
B11/B12 Snapshot + Durable Ack
B21/B22/B23 Scorer/Recovery/Tool Pair
```
