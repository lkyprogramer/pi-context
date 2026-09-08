# 验证记录与边界

## 6.0.0 审计（2026-09-08，保留）

审计源码固定 `79c1ead5a611e077df5712ba50aaa7012f424cc5`。

- 按 ZIP 原始文件字节/可执行位重建 Git tree，等于 `b67277c0d3e0a3295f718010ea09b94fedb71437`；9660 文件；附件 SHA 见 evidence/source-identity.json。
- 使用 TypeScript transpileModule 运行实际 src 模块的 15 项隔离探针，probeErrors=0。观察到的是缺陷，不是"15 项产品测试通过"。
- 本机 Node 22.16.0、TS 5.8.3 运行 src strict tsc exit 0；项目要求 Node ≥22.19.0/TS 5.9.2，因此不是正式构建成绩。
- 8 组 pairs 离线复算；未调用 Provider；原始 B2 没有 balanced 激活证据。
- 标准库参考测试 16 项（配对均值、未知值、重复 pair、UTF-8 字节上限）。

## 6.1 修订（2026-09-08）

实际执行：
- 在本机（Node 22.19.0、pi 0.85.1、Docker 29.4.0）读取 `/Users/luo/Documents/github/pi` 源码复核 [05-native-pi §6.1](audit/05-native-pi.md) 的 8 条事实；读取 CodexGame 的部署文档与 `reports/10-pi-prefix-prod.md`、`11-vs-work-vllm.md`、`09-fusion-final.md`、`results/prod-prefix/*` 形成 [07-local-stack](audit/07-local-stack.md)。
- 通过已有隧道 `GET http://127.0.0.1:18343/v1/models` 与 `/metrics` 各一次（只读），确认 `n_ctx=262144`、`ninfer:prefix_cache_hit_tokens_total`/`llamacpp:prompt_tokens_total`/`ninfer:requests_total` 计数器存在且与报告口径一致。
- `node --check` 全部 harness `.mjs`、`bash -n` 全部 `.sh`；用合成 episode 调用 `report.mjs` 的 `summarize/decide`，确认 unknown usage 计入 `unknownUsage` 而非 0、缺 H 数据时决策落到 `observe-only`（gate=mechanism）。
- `python3 scripts/validate_bundle.py` 通过（见交付消息）。
- 2026-09-08 二次修订（[08-feedback-reconciliation](audit/08-feedback-reconciliation.md)）：再次读取 Pi 源码核实 split-turn（`findCutPoint/isSplitTurn`）、run 内阈值检查相对 `transformContext` 的顺序、原生摘要模板；`node --check` 全部 harness；用合成 episode 调用 `summarize/decide/candidate`，确认 wrong-action 进质量门、`Σuncached/TTFT p50` 列、H02 `lost evidence` 触发 `candidate: post-compaction-evidence-delta`；用合成 session JSONL 验证 `verbatimQuote()` 的 true/false/null 三种输出。
- 2026-09-08 Codex 对照（[09](audit/09-codex-context-management.md)）：抓取配置参考页，`gh` 读取 PR #42385 与 main 源码六个文件；`candidates()` 用四个合成 H episode 验证三种信号同时触发、无 H 数据时为空。

未执行：
- 没有安装依赖运行 vitest、没有构建 `dist/extension.js`、没有在 4090 上跑任何 episode、没有录制种子。harness 是模板，E01 落地时按官方 `dist/index.d.ts` 修正导出名。
- 折叠成本模型（[02-fold-algorithm §6](design/02-fold-algorithm.md)）是由实测阶梯推算的估计，E03 实测校正。

## 文档包校验

```bash
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_bundle.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s reference -p 'test_*.py' -v
```

校验覆盖：JSON/Python/JS 语法、Markdown 链接与围栏、任务 DAG/文件边界/RED 代码/无占位符、20 Finding → 任务映射、26 原任务复核、场景分组与 episode 计数（`maxEpisodes = Σ arms×reps`）、15 源码探针、完整相对路径 MANIFEST。程序不会把"字段存在"当作产品实现正确性证明。

不包括真实密钥、原始私有 JSONL、思考块或用户 SQLite。
