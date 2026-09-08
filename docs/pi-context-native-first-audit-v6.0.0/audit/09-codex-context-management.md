# Codex `features.context_management.experimental_mode` 对照（2026-09-08）

用户提问：pi-context 6.1 的定位是否与 OpenAI Codex 的实验性上下文管理相似。本页记录核对到的一手事实、逐项对比，以及由此进入 6.2 候选的两项与明确不借的一项。

## 核对来源

- 配置参考页 `learn.chatgpt.com/docs/config-file/config-reference`：`features.context_management.experimental_mode`（boolean，默认 off）"Rather than repeatedly compressing context into a single summary, it uses notes and searchable history to preserve accumulated details. Requires ChatGPT sign-in on Plus, Pro, or Pro Lite."；另有 `model_auto_compact_token_limit_scope = total | body_after_prefix`。
- PR [openai/codex#42385](https://github.com/openai/codex/pull/42385)（2026-09-02 合入）："enable token-budget context, history notes, and the `new_context` tool… Keep the feature disabled for custom providers, provider credentials, non-Codex endpoints, and temporary structured threads."
- `openai/codex` main 源码（通过 GitHub API 读取）：`codex-rs/core/src/session/token_budget.rs`、`codex-rs/ext/history-notes/src/{extension,tools,backend}.rs`、`codex-rs/core/src/tools/handlers/new_context_window{,_spec}.rs`、`codex-rs/features/src/feature_configs.rs`、`codex-rs/models-manager/models.json`。
- 第三方博客（codex.danielvaughan.com）只用于定位 PR 编号，不作为事实依据。

## 它实际打开了什么

| 部件 | 源码事实 |
|---|---|
| 资格判定 | `apply_experimental_context()`：需要 `Feature::ContextManagement` 开启、模型 `supports_experimental_context`、provider 支持 Codex 后端路由且要求 OpenAI 登录、无 `env_key`/bearer/aws 凭据、账户为 Plus/Pro/ProLite。`models.json` 中仅 `gpt-6-astra` 为 `supports_experimental_context: true`（窗口 272000，`truncation_policy` 10000 token） |
| Token budget | `TokenBudgetConfig`：`reminder_threshold_tokens`（astra 默认 6144）、`auto_compact_fallback_buffer_tokens`（16384）、`guidance_message`、`reminder_message_template`、`auto_compact_fallback_prompt`；`maybe_record()` 在剩余 ≤ 阈值时发一次 reminder；存在 `get_context_remaining` 工具（guidance 文本提及） |
| `history` 工具 | 4 动作：`list_windows / list_items / read_item / search_contents`；对象是归一化历史原文；每条非 assistant item 尾部 `[id: ...]`；`read_item(window_id, item_id, offset_chars, limit_chars)`；`search_contents` 为大小写敏感字面子串；只读、最终一致；后端 `alpha/history/v2/*` |
| `notes` 工具 | 5 动作：`list_files_by_prefix / read_file / search_contents / append_to_file / write_file`；虚拟路径 `<agent>/notes/...`，单文件 ≤ 1,000,000 字节；后端 `alpha/notes/v2/*` |
| `new_context` | 描述 "Start a new context window. Does not clear, reset, or otherwise affect environment state."；提示语 "A new context window will start without summarizing conversation history."；新窗口只带 system prompt + 后端注入的 ≤ 4000 字节 `thread_hint`（`alpha/notes/v2/thread_hint`） |
| 隐私边界 | 所有工具描述含 "private model-only state… Never disclose"；数据在 OpenAI 后端，用户不可见 |

astra 的 `guidance_message` 要求模型：边做边用 `notes` 记 goal/decisions/progress/learnings/next steps 与相关 item 的 window ID/item ID；重置后先读 checkpoint，再用 `history` 找细节，有 ID 直接 `read_item`，没有则 `list_items`/`search_contents`。

## 与 6.1 的对比

| 维度 | Codex experimental_mode | pi-context 6.1 |
|---|---|---|
| 压缩机制 | 无摘要：`new_context` 硬重置 | 保留 Pi 原生 LLM 摘要（split-turn、run 内触发由 Pi 做） |
| 连续性载体 | 模型自写 `notes` | Pi 原生结构化摘要 |
| 精确回读 | `read_item`，item ID 内联在每条 item 尾部 | `pctx_history read(ref)`，ref 出现在 search 结果与 stub，不内联 |
| 搜索 | 字面子串，后端 | SQLite FTS5，本地，scope 限当前会话祖先 |
| 中途瘦身 | 无；窗口内 append-only，满则整窗重置 | balanced 在 60% 一次折叠后冻结 |
| 模型侧预算信号 | `get_context_remaining` + 一次 reminder + fallback buffer | 无；用量只给用户（`/pctx status`） |
| 存储/可见性 | OpenAI 后端，用户不可见 | 本地 SQLite，用户可查 |
| 适用模型 | 仅 gpt-6-astra + Codex 后端 | 任意 Pi 模型，含本地 Qwen |
| 主要风险 | 模型不记笔记则整窗丢失（fallback 强制最后 16k 内写一次） | 模型不用 `pctx_history` 则退化为用户手动找回（H01/H02 专测） |

## 对本包的处理

- **验证方向**：一线 agent 用 "searchable history + exact read + 按 ID 引用" 替代反复摘要，与 6.1 把 evidence/recall 提升为第一核心一致。
- **进入 6.2 候选**（[00-target §6.2 候选二、三](../design/00-target.md)）：内联 ref 标记；与折叠合并的一次性模型侧提示。两者均有取自 E03 报告的机械立项条件，且都不改 6.1 的 12 任务。
- **不借**：模型自写 notes 替代摘要。理由：依赖专门训练的模型与后端强制 fallback；对本地 Qwen 无保证；属于 6.1 拒绝的第二套 LLM 摘要（[08 §8 C](08-feedback-reconciliation.md)）。
- **不适用**：该功能本身对 API key / 自定义 provider / 本地模型全部关闭，不能在 4090 栈上直接使用或对照实测。

## 未核实

- `thread_hint` 与 `history` 的后端归一化规则（`alpha/*` 接口）不公开，未核实其索引粒度与截断策略。
- `get_context_remaining` 工具的实现文件未读取，仅见于 guidance 文本。
- 未在真实 Codex 会话中观察 reminder 与 `new_context` 的实际行为。
