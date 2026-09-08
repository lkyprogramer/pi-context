# 本地推理栈事实：4090 + NInfer + prefix cache 对本插件意味着什么

来源：用户已验证的部署与报告（[S16–S18](../reference/SOURCES.md)）。数字是 2026-09-08 在现网（不停 unit）用 Pi Java 三题与 HTTP 探针实测，不是本包重跑。

## 现网

| 项 | 值 |
|---|---|
| 机器 | `192.168.10.29`，单卡 RTX 4090 24GB |
| 引擎 | NInfer `tensorninja/ninfer-4090@44a2c6c`，容器 `ninfer-4090-prod` |
| 兼容层 | `openai_compat_proxy.py` :18343（默认 `reasoning_effort=medium`，翻译 `chat_template_kwargs`） |
| 调用名 | `openclaw/Qwen3.8-27B-WORK`（与旧 llama.cpp WORK 同名同口） |
| 窗口 | `--max-context 262144 --kv-capacity 262144`，`/v1/models` `n_ctx=262144` |
| KV | `rk4v4-e8`（4-bit E8 lattice） |
| 投机 | MTP `--draft-tokens 3 --lm-head-draft` |
| 并发 | `--max-concurrency 1`，`--max-pending-requests 8` |
| 前缀 | `--prefix-checkpoint-policy rolling-tool`，`--continuation-cache l1-l2`（L1 6GiB GPU / L2 8GiB host） |
| 思考 | medium 默认，`--preserve-thinking` |
| 访问 | Mac 经 SSH 隧道 `127.0.0.1:18343`；`/metrics` 同口 |

## 实测（决定 6.1 设计的四个数字）

1. **Pi 追加式历史下 prefix 复用有效**：Java 三题 24 次请求，`prefix_cache_hit_tokens +154961`，实算 prefill `+26845`，命中 ≈ 85%，`continuation_stable_prefix_restores +20`。
2. **改旧消息则前缀全丢**：HTTP 探针"在末尾追加"命中 50%；"把 reminder 拼进第一条 user"命中 0。任何对早期消息的改写都让改写点之后的 KV 作废。
3. **重新 prefill 的价格**：184k 冷 TTFT 94s（≈1974 tok/s）；100k append 请求 TTFT 3.3s；100k exact 命中 TTFT 0.6s。
4. **decode 随深度下降但平缓**：thinking=medium 4k/64k/120k/184k ≈ 127/111/115/98 tok/s；旧 WORK 是 78/60/47/38。

usage 回传：兼容层返回 OpenAI 风格 `usage.prompt_tokens_details.cached_tokens`（探针记录 `cached_tokens: 86/173`）；Pi 的 openai-completions 把它归一化为 `usage.cacheRead`（`packages/ai/src/api/openai-completions.ts:1520`）。因此插件与评测都能从 Pi 的 `message_end` 直接读到每请求的缓存命中，不必解析 `/metrics`；`/metrics` 用作独立对照。

## 对插件设计的推论

| 6.0.0 的假设 | 本地栈事实 | 6.1 的取舍 |
|---|---|---|
| 减少 input token 就是收益（API 计费思维） | 本地无 token 费；append 请求只 prefill 增量 | 收益重新定义为：推迟有损的原生摘要、延长会话寿命、保留逐字回读 |
| 每 8 次成功请求可重规划一次 epoch | 每次改前缀 = 几十秒重新 prefill | 只在越过阈值时折叠一次，之后冻结；trigger 60% / target 40% |
| 折叠越早越省 | 早折叠 = 频繁作废缓存 | 短会话（< 157k）永不折叠，balanced ≡ observe |
| 需要 ledger 精确知道模型看过什么 | Pi 日志里的 assistant usage 就是"看过"的证据 | 派生暴露 |
| 摘要/胶囊可以补足信息 | 原生摘要本身要冷 prefill 整段历史（≈2 分钟@245k） | 不做摘要类机制；把避免/推迟它当成目标 |
| 成本用 API 价格表估 | `RequestRecord.usage.cacheRead` + `/metrics` 差值 | 报告用 prefill token 与墙钟，不用美元 |

## 评测口径的约束

- 单并发：episode 必须串行，`/metrics` 差值才能归属到 episode。
- 隧道到现网：E 阶段**不停 unit、不开评测容器、不改 4090 上任何文件**（这与 CodexGame 的融合评测流程不同——那里会停现网）。
- `n_ctx` 校验：每 episode 前确认 `262144`；回滚到 llama.cpp WORK 时是 `200192`，engine 不同不能混算。
- 窗口 profile 只改 Pi 的 `models.json.contextWindow`；服务端不变。w64k 让原生阈值（49152）与折叠 trigger（39321）在一个 Java 题 + 种子历史内可达。
- `thinking=medium` 与现网默认一致；不用 off（会改变模型行为与 tool 次数）。
- 不做多用户、不做 vLLM/WORK 对照（那是 CodexGame 的课题）。

## 还没有的证据（6.1 的 E03 要补的）

- 折叠一次的实际重新 prefill 代价（`prefillTokensDelta` 与折叠后首请求 TTFT）。
- 折叠后 `cacheRead/input` 回升到 ≥ 0.5 需要几个请求。
- 模型在 stub 面前会不会主动调用 `pctx_history`；回读页数与预算。
- 262k 窗口下真实长会话（H03）里折叠发生的位置与是否避免了一次原生压缩。
