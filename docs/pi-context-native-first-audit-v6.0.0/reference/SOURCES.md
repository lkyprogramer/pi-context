# 来源、版本与可信度

检索/抓取日期2026-09-08。固定SHA链接用于源码事实；main/README检索只作候选发现。未对社区项目运行统一benchmark，不给它们虚构性能排名。当前源码中的具体缺陷行号详见audit/findings.json。

## 用户分支与附件

- **S01** 用户附件 `e35e85f1-f855-465a-a176-8587511da731.zip`；bytes/SHA/tree见[evidence/source-identity.json](../evidence/source-identity.json)。实际重建Git blob/tree比对，不只用压缩包注释。
- **S02** [分支git commit](https://github.com/lkyprogramer/pi-context/commit/79c1ead5a611e077df5712ba50aaa7012f424cc5)，tree `b67277c0d3e0a3295f718010ea09b94fedb71437`。
- **S03** [当前实际入口](https://github.com/lkyprogramer/pi-context/blob/79c1ead5a611e077df5712ba50aaa7012f424cc5/src/extension.ts)、[adapter](https://github.com/lkyprogramer/pi-context/blob/79c1ead5a611e077df5712ba50aaa7012f424cc5/src/pi/adapter.ts)、[plugin](https://github.com/lkyprogramer/pi-context/blob/79c1ead5a611e077df5712ba50aaa7012f424cc5/src/plugin.ts)。本次读源码并进行15项隔离探针，不等价Pi端到端。
- **S04** [分支随带T01–T26规格](https://github.com/lkyprogramer/pi-context/tree/79c1ead5a611e077df5712ba50aaa7012f424cc5/docs/pi-context-native-first-evolution-v5.0.0)。这是本轮一致性判断的主规格，不是旧main的PCR C00任务。
- **S05** [G4 runner](https://github.com/lkyprogramer/pi-context/blob/79c1ead5a611e077df5712ba50aaa7012f424cc5/eval/live-g4.mjs)、[agent](https://github.com/lkyprogramer/pi-context/blob/79c1ead5a611e077df5712ba50aaa7012f424cc5/eval/sandbox/g4-agent.mjs)、[smoke](https://github.com/lkyprogramer/pi-context/blob/79c1ead5a611e077df5712ba50aaa7012f424cc5/eval/smoke.mjs)、[report](https://github.com/lkyprogramer/pi-context/blob/79c1ead5a611e077df5712ba50aaa7012f424cc5/artifacts/v5-evaluation/report.json)。用户提交结果，不是本次重跑模型。
- **S06** [分支特定提交列表API](https://api.github.com/repos/lkyprogramer/pi-context/commits?sha=v5%2Fnative-first&per_page=12)、[该SHA Actions API](https://api.github.com/repos/lkyprogramer/pi-context/actions/runs?head_sha=79c1ead5a611e077df5712ba50aaa7012f424cc5&per_page=10)。返回runs=0仅表示本次查询无记录，不证明本地没有跑测试。检索通用search_commits曾返回main历史，已排除。

## 官方Pi最新源码（不是旧版issue推测）

- **S07** [package版本0.85.1](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/package.json)。源码HEAD `b2602be77cb7b0de45dd616407fd210daa48aa75`，不假定与npm安装gitHead相同。
- **S08** [compaction.ts](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/src/core/compaction/compaction.ts)。阈值、cut、previousSummary、split-turn、usage、重试与cache选项；已读主要实现。
- **S09** [utils.ts](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/src/core/compaction/utils.ts)。tool-result前2000字符、fileOps、序列化。
- **S10** [agent-session.ts](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/src/core/agent-session.ts)、[官方extensions types](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/src/core/extensions/types.ts)。已读next-turn refresh、afterToolCall、compactionEntry以及reason/willRetry合同。单个helper检查不是所有provider最终budget的数学证明。

## 本轮社区一手实现

- **S11** [context-fold package](https://github.com/Middlewatch/context-fold/blob/3bd8056a7c43c231418154d37bc2db991eeab2c9/package.json)、[apply.ts](https://github.com/Middlewatch/context-fold/blob/3bd8056a7c43c231418154d37bc2db991eeab2c9/src/core/apply.ts)。固定SHA，0.4.0；正文替换、durable ID、ambiguous ID拒绝。README阈值与“更好”数字属于维护者个案，不作为统一实验。
- **S12** [pi-context-manager/prune.ts](https://github.com/psmfd/pi-context-manager/blob/main/prune.ts)。本次文件blob `95d0a1704c9c6206e64dfdb72e87acc0ea5af0d4`；首见冻结、保留非文本和toolCallId。未固定整个repoSHA；安装前另验宿主/依赖。
- **S13** [最新Posthorse README](https://github.com/fitchmultz/pi-posthorse/blob/6cdb50a42a3474a9b89d6fed1e86c831425ed9e2/README.md)。仍依赖fitchmultz/pi fork，官方stock不支持；新的UI卡片不改变此事实。前一审计核心读取固定在836a23…；本次不冒充全文重跑新版测试。
- **S14** [Smart Compact verify.ts](https://github.com/alpertarhan/pi-smart-compact/blob/687f72c45d27f98ca36d7d1ca9b3941817b0e223/src/phases/verify.ts)。已读typed findings/path evidence/high-risk outcome处理；未执行该项目，不泛化为逻辑完备验证。

## 本轮发现但仅README/检索级的候选

- **S15** [pi-async-compaction README](https://github.com/almogdepaz/pi-async-compaction)。Exa抓取正文：pending/ready/stale、某些情况下abort+continue、复用原生compact，自报测试Pi0.80.3。未核对最新完整代码SHA，不建议无验证直接替换本分支。
- **S16** [pi-compaction-model](https://github.com/JMHSV/pi-compaction-model)。Exa维护者README检索；专用摘要模型调用Pi native compact。index.ts路径抓取404，因此不把README当源码审计。
- **S17** [PI-CoACT](https://github.com/pinion05/PI-CoACT)、[pi-context-prune](https://github.com/jjuraszek/pi-context-prune)。仅候选发现与维护者描述，前沿/批次/防抖可作为思路；名称/当前安装能力未独立验证。
- **S18** [Hypa](https://github.com/Hypabolic/Hypa)。既有附件研究对入口减噪的总结加本轮背景检索，不是本次最新逐行审核。

## 6.1 新增：本地推理栈（用户自有一手资料，2026-09-08）

- **S19** `/Users/luo/Documents/github/CodexGame/docs/openclaw-qwen38-ninfer.md`：4090 NInfer 部署、参数、兼容层、`/metrics`、prefix cache 行为与运维约束。本轮已读全文。
- **S20** `/Users/luo/Documents/github/CodexGame/output/qwen38-27b-4090-ninfer/reports/10-pi-prefix-prod.md` 与原始 `output/qwen38-4090-compare/results/prod-prefix/{metrics-*.json,http_probe.json}`：Pi Java 三题 24 请求、prefix 命中 154961 / prefill 26845（≈85%）、`stable_prefix_restores +20`；改第一条 user 命中 0。本轮已读并核对原始 JSON。
- **S21** `reports/09-fusion-final.md`、`reports/11-vs-work-vllm.md`：262k 档 decode/TTFT 阶梯、Java 墙钟、WORK/vLLM 对照。已读。
- **S22** `output/qwen38-4090-compare/scripts/run_pi_prefix_prod.sh`、`scripts/run_pi_java.sh`、`bench/parse_pi_json.py`、`pi-config/prod/models.json`：已验证的 Pi 调用方式与 metrics 抓取方式，是本包 harness 的直接来源。已读。
- **S23** 本机只读探针：`GET 127.0.0.1:18343/v1/models`（`n_ctx=262144`）、`GET /metrics`（计数器名与 S20 一致）。2026-09-08 执行一次。

## 6.1 新增：文献（前一会话子代理检索，机制级结论；URL 在引用处复核）

- **S24** JetBrains Research, *The Complexity Trap: Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management*, [arXiv:2508.21433](https://arxiv.org/abs/2508.21433)。SWE-bench Verified 上确定性遮罩旧观测与 LLM 摘要成本相当、分数不降；摘要有"轨迹延长"副作用。本包据此不做第二层摘要。
- **S25** Anthropic 文档 *Context editing*（`clear_tool_uses` 策略，含 `trigger`/`keep`/`clear_at_least`/`exclude_tools`）与工程博客 *Effective context engineering for AI agents*。阈值触发、一次清足够多、保留最近 N、错误/特定工具排除——与本包折叠参数一一对应。检索级引用；使用前在 docs.anthropic.com 复核字段名。
- **S26** Manus 博客 *Context Engineering for AI Agents: Lessons from Building Manus*：KV-cache 命中率是生产 agent 的首要指标；append-only、不改旧消息、可恢复的压缩。检索级。
- **S27** *ACON* / *Self-Compacting Agents*（子代理检索摘要）：需要精确回访旧状态的任务上纯截断掉分；摘要会造成 correct→wrong 转移。用作"精确回读不是可选项"的支撑，未逐字重核数字，不在本包引用具体百分比。
- **S28** 社区 Pi 生态：oh-my-pi fork 的 cache-aware `pruneSupersededToolResults`、pi-condense 的 `agent-message` 触发。仅作方向印证；本包不依赖 fork。

## 6.1 新增：Codex 上下文管理对照（2026-09-08）

- **S29** `learn.chatgpt.com/docs/config-file/config-reference`：`features.context_management.experimental_mode`、`model_auto_compact_token_limit_scope` 条目原文。已抓取。
- **S30** [openai/codex#42385](https://github.com/openai/codex/pull/42385)（2026-09-02 合入）及 main 源码 `codex-rs/core/src/session/token_budget.rs`、`codex-rs/ext/history-notes/src/{extension,tools,backend}.rs`、`codex-rs/core/src/tools/handlers/new_context_window{,_spec}.rs`、`codex-rs/features/src/feature_configs.rs`、`codex-rs/models-manager/models.json`（`gpt-6-astra` 的 `token_budget` 默认与 guidance 文本）。通过 GitHub API 读取，见 [09](../audit/09-codex-context-management.md)。后端 `alpha/history|notes/v2/*` 接口行为未核实。

## 历史文档的使用边界

先前材料把“原文持久化、活跃表示、可寻址、可检索、行为等价”明确分层；本次继续采用该问题框架，不把其中2026-08的数值、旧Pi行为或项目排名当最新事实。尤其“生成在某类理论任务可胜选择”不能推出任意LLM摘要比所有确定性观察折叠更优。引用的长研究文档已由用户提供；本包没有沿用未重新核验的论文性能数字。

## 检索记录

[queries.json](queries.json)记录Exa四组查询和额外抓取。最终建议只依据上面的source-level机制与本次分支问题，不按star、README口号或全网摘要打分。
