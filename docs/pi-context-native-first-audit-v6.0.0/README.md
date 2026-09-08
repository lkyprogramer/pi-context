# pi-context v5/native-first：审计 + 6.1 可执行修订计划

文档版：**6.1.0**（在 6.0.0 审计包上原地修订）；日期 2026-09-08。**这是对现有 v5 实现的收敛修订，不是重写。** 审计对象 `79c1ead5a611e077df5712ba50aaa7012f424cc5`（tree `b67277c0…`）。

## 6.1 相对 6.0.0 改了什么

6.0.0 的 20 条缺陷（[03-findings](audit/03-findings.md)）逐条复核成立，保留。以下三处判断被新证据改写：

1. **本地栈事实**（[07-local-stack](audit/07-local-stack.md)）：4090 现网 NInfer 在 Pi 追加式历史下 prefix 命中约 85%，改旧消息会让改写点之后的 KV 全部作废（≈2000 tok/s 重新 prefill）。因此"每 8 次成功请求重规划 epoch"必须改成**越阈值折叠一次、之后冻结**；收益不是省 token，而是推迟一次有损且昂贵（冷 prefill 整段历史 + 摘要）的原生压缩，并保留逐字回读。
2. **Pi 源码复核**（[05-native-pi §6.1](audit/05-native-pi.md)）：压缩阈值锚在真实 provider usage，插件投影确实推迟原生压缩；`context` 事件已深拷贝；`compactionEntry` 字段名；`getContextUsage()` 可在 hook 内调用。这些让"exposure ledger / ACK / generation"没有必要，改为从日志**派生暴露**。
3. **文献与社区**（[06-community](audit/06-community.md)）：确定性观察遮罩 + 精确回读优于 LLM 摘要（JetBrains Complexity Trap、Anthropic context editing、Manus、oh-my-pi、pi-condense 都同向）；pin 胶囊与语义摘要没有支撑，删除。
4. **外部反馈核对**（[08-feedback-reconciliation](audit/08-feedback-reconciliation.md)）：对 "#128/#330 落地后 pi-context 何去何从" 的评估稿逐条核实。产品定位改为 **Pi Native 之上的 evidence/recall + cache-aware projection 层**（[00-target](design/00-target.md)）；采纳 12 项评测指标（wrong-action、Σuncached、TTFT、lost evidence 进报告）；拒绝逐请求经济学重规划与 6.1 内重建 checkpoint，后者作为 6.2 候选由 E03 的 `lost evidence` 列决定是否立项。
5. **Codex 对照**（[09-codex-context-management](audit/09-codex-context-management.md)）：OpenAI Codex `features.context_management.experimental_mode`（仅 gpt-6-astra + Codex 后端）同样以 searchable history + 按 ID 精确回读替代反复摘要，印证方向；借入两项 6.2 候选——内联 ref 标记、与折叠合并的一次性模型侧提示（[00-target §6.2](design/00-target.md)），E03 报告 `candidates` 段机械给出立项信号；不借模型自写 notes 替代摘要。

结果：**产品 = observe（默认）+ 安全的 `pctx_history`；balanced = 阈值触发的无损折叠（默认关闭，E 阶段在 4090 上验证）**。删除 checkpoint/staging/semantic/ledger 四块。

## 先读

[6.1 目标设计](design/00-target.md) → [唯一合同](design/01-contracts.md) → [折叠算法与成本模型](design/02-fold-algorithm.md) → [AI 执行入口](AI-START-HERE.md) → [tasks/](tasks/README.md)。

其余：[结论（6.0.0）](audit/00-verdict.md)、[缺陷](audit/03-findings.md)、[Pi 事实](audit/05-native-pi.md)、[本地栈](audit/07-local-stack.md)、[社区](audit/06-community.md)、[外部反馈核对](audit/08-feedback-reconciliation.md)、[Codex 对照](audit/09-codex-context-management.md)、[T01–T26 一致性](audit/02-compliance.md)、[报告复算](audit/04-evaluation.md)、[测试协议](testing/00-protocol.md)、[执行手册](testing/01-runbook.md)、[隔离](testing/02-isolation.md)、[本地 harness](testing/03-local-harness.md)、[场景](testing/scenarios.json)、[来源](reference/SOURCES.md)、[验证边界](VALIDATION.md)。

## 12 个任务，5 个阶段

| 阶段 | 任务 | 一句话 |
|---|---|---|
| A | A01 | 官方类型、真实配置加载、status、`compactionEntry` |
| B | B01 B02 B03 | 统一字段引用；scope 安全 FTS5 检索与真分页；预算内 UTF-8 回读与图片 |
| C | C01 C02 C03 | 删四块；派生暴露与批次保护；阈值折叠 plan/render/失效/遥测 |
| D | D01 | 真官方 Pi + 受控 provider 接线测试，`pnpm smoke` |
| E | E01 E02 E03 E04 | 4090 本地题库与运行器；容器判题；执行矩阵与报告；决策与收口 |

E 阶段用现网 `openclaw/Qwen3.8-27B-WORK`（隧道 `127.0.0.1:18343`，thinking=medium，不停 unit），12 场景 37 个 episode，三门（质量/机制/成本）机械判定 `observe-only` 或 `limited-balanced-trial`。全部脚本、Pi 配置、题目在 [testing/harness](testing/harness/README.md)。

## 本包提供什么 / 不提供什么

提供：审计事实、15 项源码探针、26 项旧任务处置、12 张可执行任务卡（文件边界、接口、RED 测试、负例、验收）、场景矩阵、可直接落到 `eval/local/` 的 harness 脚本、校验脚本。不提供：已实现的插件、任何新的模型成绩。E 阶段的数字只能来自真实运行的 `artifacts/local-eval/<runId>/report.md`。

离线检查：

```bash
python3 scripts/validate_bundle.py
python3 -m unittest discover -s reference -p 'test_*.py' -v
```
