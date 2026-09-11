# 运行手册

所有命令在仓库根目录执行。凭据只从本地 `.env`（`PCR_LIVE_BASE_URL`、`PCR_LIVE_API_KEY` 或 `PCTX_MODEL_API_KEY`、`PCR_LIVE_MODEL`）读取；本手册与迭代记录不得粘贴其值。

## 0. 环境核对

```bash
node --version                      # 宿主 22.17 可运行开发路径；沙箱镜像 22.19 满足 engines
pnpm --version
docker image inspect pctx-t21-sandbox:0.85.1 --format '{{.Id}}'
git status --porcelain              # S07 前必须为空
git rev-parse HEAD
```

## 1. 每任务（S01–S06）

```bash
# RED
<任务卡 RED 命令>
# 实现后
<任务卡 完成验证 命令>
pnpm typecheck
git add <任务卡文件范围内实际改动的文件>
git commit -m "<描述最终行为>"
```

S02–S04 的离线复算（诊断数据，不作交付）：

```bash
for r in review-qc-20260910 review-qc-20260911 review-qc-20260911-fold1; do
  node eval/local/report.mjs --run artifacts/local-eval/$r >/dev/null
  node -e "const d=require('./artifacts/local-eval/$r/report.json').decision; console.log('$r', d.decision, d.objective?.primary?.relativeChange, JSON.stringify(d.discordant), d.candidates?.map(c=>c.candidate+':'+c.status))"
done
```

期望（S04 完成后）：三次都 `inconclusive`（dirty / 分母 16≠24），`relativeChange` ≈ 0.060 / 0.059 / −0.642，fold1 `discordant` 含 Q05 r1、r2，`candidates` 含 `fold-time-model-hint:below-gate`。

## 2. G1 受控（S05/S06/S07 前置）

```bash
pnpm build
node eval/local/secure-preflight.mjs --canary
node eval/local/run-matrix.mjs --mode controlled --config eval/local/review-matrix.json --out /tmp/pctx-controlled-$(date +%s)
node eval/local/run-matrix.mjs --mode live --dry --config eval/local/review-matrix.json --out /tmp/pctx-dry-$(date +%s)
```

全部 exit 0；preflight 输出含 `"agentEgress":false`；dry 输出 84 行 episode 计划。

## 3. G2 live（仅 S07）

```bash
RUN=artifacts/local-eval/review-r8-$(date +%Y%m%d)
PCTX_LIVE=1 node eval/local/run-matrix.mjs --mode live --config eval/local/review-matrix.json --seed 42 --out "$RUN"
# 中断后
PCTX_LIVE=1 node eval/local/run-matrix.mjs --mode live --config eval/local/review-matrix.json --resume "$RUN"
```

监控点（不需要逐条看）：

- 每行 `[n/84] <case>/<arm>/r<k> → <status> oracle=<bool> folds=<n> wall=<s>`；
- 首个 `X01/native`：打开 `$RUN/<episode>/requests.jsonl`，确认单次 `cat` 的 fresh input 在 4–8k 且无截断；不满足则停止，回 S06 校准；
- 首个 `W-*/balanced`：确认前两条 request `replacementsApplied=0`，第 3–4 条 ≥ 1；
- `blocked` 累计 > 16（20%）→ 停止。

## 4. 报告、bundle、交付目录

```bash
node eval/local/report.mjs --run "$RUN"
node -e "import('./eval/local/bundle.mjs').then(m=>m.writeBundle('$RUN'))"
node -e "import('./eval/local/bundle.mjs').then(m=>{const b=JSON.parse(require('fs').readFileSync('$RUN/bundle/bundle.json','utf8'));console.log(m.recomputeDecision(b).decision)})"
cp -r artifacts/local-eval/review-final artifacts/local-eval/review-final-r7-backup
rm -rf artifacts/local-eval/review-final && mkdir -p artifacts/local-eval/review-final
cp -r "$RUN"/bundle/* artifacts/local-eval/review-final/
sed -n '1,/^## oracle/p' "$RUN/report.md" > artifacts/local-eval/review-final/REPORT.md
(cd artifacts/local-eval/review-final && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 shasum -a 256 | sed 's#\./##' > MANIFEST.sha256)
basename "$RUN" > artifacts/local-eval/CURRENT_RUNID
grep -rl "session/" artifacts/local-eval/review-final && echo "FAIL: session content in bundle" || echo ok
```

## 5. 文档与最终检查

```bash
pnpm exec vitest run test/unit/docs-decision-consistency.test.ts --config vitest.config.ts
pnpm check
git status --porcelain
```

提交范围只含 S07 文件清单。不 push。

## 6. 阻塞时

| 症状 | 处置 |
|---|---|
| `docker image inspect` 失败 | BLOCKED；不在宿主运行 agent |
| `secure-preflight` `agentEgress:true` | BLOCKED；检查 `run-agent.sh` 是否有第二个 `docker run` 路径 |
| `models fetch` / tunnel 失败 | 检查 18343 隧道；不改 4090 配置 |
| `engine-changed` | 该 episode blocked；查 `/v1/models` 是否换了 `n_ctx` |
| `live run refused: working tree dirty` | 提交或 stash；不得用 `--allow-dirty` 产出交付 |
| X01 native `nativeCompactions=0` | X01 unexercised；S06 调 `lines`，新 runId 重跑 |
