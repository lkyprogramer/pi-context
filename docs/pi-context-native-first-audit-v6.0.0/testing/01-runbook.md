# AI 执行手册（6.1）

所有命令在用户 repo 根目录 `/Users/luo/Documents/github/pi-context` 运行。本包不写入任何评测结果；结果在 `artifacts/local-eval/<runId>/`。

## 0. 环境事实（每次开始先核对，不核对不动手）

```bash
node --version            # 必须 v22.19.x（宿主 pi 与 T21 镜像同版本）
pnpm --version
pi --version              # 必须 0.85.1
npm root -g               # 官方 pi 在 <root>/@earendil-works/pi-coding-agent
docker version --format '{{.Server.Version}}'
git -C . status --short | head   # 有 dirty 就先记录，不伪称 HEAD
```

4090 现网只经隧道访问，不登录去改东西：

```bash
bash eval/local/ensure-tunnel.sh   # E01 之前用 testing/harness/ensure-tunnel.sh
curl -fsS http://127.0.0.1:18343/v1/models | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d["data"][0]; print(m["id"], m["meta"]["n_ctx"])'
# 期望：openclaw/Qwen3.8-27B-WORK 262144
curl -fsS http://127.0.0.1:18343/metrics | grep -E '^(ninfer:prefix_cache_hit_tokens_total|llamacpp:prompt_tokens_total|ninfer:requests_total) '
```

`n_ctx` 不是 262144 → 现网被切回 llama.cpp WORK（200192），E 阶段停止，等用户切回 NInfer。

## 1. 开发阶段（A–D）的循环

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run <任务卡 testFile> --config vitest.config.ts   # 先 RED
# 实现
pnpm exec vitest run <任务卡列出的测试> --config vitest.config.ts   # GREEN
pnpm typecheck
git add <任务卡允许的文件>; git commit -m "<type>(<taskId>): ..."
```

阶段末：B 末跑 `test/security test/integration/history-read.test.ts test/integration/search.test.ts`；C 末跑 `test/property/invariants.test.ts` 与全部 `test/unit`；D 末 `pnpm smoke`。

## 2. E 阶段 preflight（一次）

1. `pnpm build && node scripts/packed-host.mjs` → 记 `dist/extension.js` sha256、tarball sha256。
2. `node eval/sandbox/build-image.mjs` → 记镜像 digest。
3. `bash eval/local/grade.sh L04 eval/local/fixtures/L04/initial /tmp/g-bad` 必须 `passed:false`；对 KnownGood 必须 `passed:true`（E02 已做，此处再确认）。
4. `node eval/local/record-seed.mjs --out eval/local/seeds/java-three-nonce.jsonl`（约 10–15 分钟；只做一次；nonce 写 `.secret`）。
5. `pnpm eval:local -- --dry --out /tmp/pctx-dry` 看顺序与预算。

## 3. E03 运行

```bash
RUN=artifacts/local-eval/$(date +%Y%m%d-%H%M%S)
pnpm eval:local -- --out "$RUN"          # 串行；期间不要在 4090 上跑其他负载
pnpm eval:report "$RUN"
```

预算（冻结在 manifest，首跑失败不延长）：

| 项 | 上限 |
|---|---|
| episode 墙钟 | 900 s（H03 3600 s） |
| episode 模型调用 | 40（H03 200） |
| episode 工具调用 | 80（H03 400） |
| 总 episode | 37 |
| 总墙钟 | 3.5 h（L 24×≈45 s、H01/H02 12×≈4 min、H03 ≈40 min、判题与容器启动） |

每 episode：`ensure-tunnel` → `/v1/models` 校验 → `metrics-snap before` → Agent 容器运行 → `metrics-snap after` → 判题容器 → `assertArm` → 追加 `episodes.jsonl/requests.jsonl`。

同 episode 已发生的模型调用立刻计入预算；transport 空响应最多重试 1 次同输入；内容失败、oracle 失败、工具循环不重试。

## 4. 中止与回滚

- 任一 episode 出现：scope 泄漏（`pctx_history` 返回非当前会话内容）、hash 不匹配却返回 verified、user/assistant 消息被改、工具批次丢失、判题容器越界 → **停止整个 run**，保留失败产物，产品退 observe，回对应任务修。
- 现网 `n_ctx` 变化或 metrics 计数归零 → 当前 episode `blocked`，run 继续，report 标 `engine-changed`。
- 模型没完成任务仍是 failed，不改 case、不加提示词。

## 5. 输出最小集

`manifest.json`、`episodes.jsonl`、`requests.jsonl`、`report.md`、`report.json`，加每 episode 目录（`events.jsonl`、`status.json`、`grade.json`、`metrics-before/after.json`、`session/` 副本）。`events.jsonl` 不含工具结果正文。结果目录不提交 git；iterations 记录只贴 report 的表与决策段。

## 6. H03 dogfooding（可选，手动）

```bash
# 主机上，用你平时的 pi，只加载插件并开 balanced
cat > /tmp/pctx-h03/.pi/pctx.json <<'EOF'
{ "schemaVersion": 6, "profile": "balanced", "telemetry": { "includeContent": false, "jsonl": true, "maxLogBytes": 5242880 } }
EOF
cd /tmp/pctx-h03 && pi -e /Users/luo/Documents/github/pi-context/dist/extension.js
# 依次粘贴 eval/local/cases/H03 的六段任务；每段后 /pctx status 看 contextPercent、folds、lastRequests
```

telemetry 在 `~/.pi/agent/pctx/telemetry/<sessionId>.jsonl`；`node eval/local/parse-session.mjs <session.jsonl>` 可离线复算。
