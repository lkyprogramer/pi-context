# 综合结论

## 一句话

**保留 6.1 单插件与默认 observe。机制已被三次 live run 证明；拿不到结论是评测门和场景设计的问题；下一步不是改插件算法，而是修 harness、补两条 lane、在干净 HEAD 上重跑一次。**

## 已经做对的部分（第 7 轮 R01–R10 的成果，在 live 中得到验证）

- ActiveView 折叠只作用于当前出站消息：每个 balanced Q episode 恰好 1 次 fold、5–6 个替换、移除 ≈35k tokens；`removed/invalidated` 一致（`evidence/run-aggregates.json`）。
- 0 次 `protectedIntact=false`、0 次 `outsideEditable>0`、0 次折叠 isError（三次 run 共 48 个 balanced episode）。
- 历史回读真实发生并可校验：fold1 run 18 次 `pctx_history` read，其中 16 次 hash 匹配（`verifiedReads`）；每个 Q case 至少一次。6.1 计划最大的不确定项——"模型是否会主动回读"——在 Qwen3.8-27B 上是肯定的。
- balanced 臂 native compaction 0 次；native 臂 3–4 次，每次成本可从 `requests.jsonl` 直接读出：≈4.7–6k tokens 摘要生成 + 24–30k 冷重预填。
- 分页协议、索引配额、凭据 broker、attempt ledger 的定向测试都在 `pnpm check` 内通过（200 tests，本轮审计已实跑，exit 0）。

## 为什么三次 run 都是 `review-needed`

`eval/local/accounting.mjs:157`：任一 pair 的 `evidencePassed !== true` 即 `review-needed`；`gate.mjs:101-103` 把 `evidencePassed` 定义为 candidate 未失败。Q05 balanced r2 失败（模型没有回读，`historyReads=0`），于是全局 `review-needed`。同一 run 里 native 也在 Q05 失败 1 次（fold1 run 中该失败伴随 1 次 native compaction）。配对成功率差为 0。

这条规则把"候选新增失败"实现成了"候选任何失败"。当模型基线通过率本身是 87–94%（native 14–15/16）时，2 rep 的设计无法区分抖动与退化；即使把规则改成配对不一致，2 rep 仍不够。

更深一层：`run-matrix.mjs:155` 把 `plan.objective` 冻结为 `{known:false, relativeChange:null}` 且从未回填；`accounting.mjs:169` 因此最多只能到 `quality-qualified-cost-unknown`。**当前 pipeline 在任何数据下都不可能输出 `limited-balanced-trial` 或 `history-only`。**

## 数字说明了什么（详见 `audit/03-run-evidence.md`）

| run | 折叠时机 | fresh input | cacheRead | wall 总 | 含义 |
|---|---|---:|---:|---:|---|
| 20260911 | 第 2 请求（warm cache） | +5.9% | −78% | −8.9% | 会话中折叠：预填不省，KV 体积与 compaction 省 |
| 20260911-fold1 | 第 1 请求（resume 冷启动） | −64% | −56% | −30% | 冷启动折叠：预填直接少 33k |

两次 run 的差别只来自 `44e8333b`（持久化 seed 在首个 resume 请求前折叠）。fold1 的 −64% 是 resume 场景特有的；日常长会话里越过 60% 发生在 warm cache 上，对应的是 20260911 那组数字。

## 上限判断

- 机制上限：Q lane 能证明的部分已经到顶——折叠稳定、回读可校验、0 副作用。
- 模型上限：回读是 opt-in，16 个 balanced Q episode 里 1 次没回读。这是模型属性；插件能做的只有 stub 文案与提示（6.2 候选三），且该信号目前只有 1 个样本，未达候选门。
- 引擎上限：prefix cache 让 warm 会话中折叠在 fresh input 上无收益；折叠唯一的代价是一次前缀失效，唯一能省的预填是折叠后的小尾巴。
- 经济上限**未知**：插件论点（推迟 lossy 的 native compaction、在多次 compaction 后仍能精确回读）对应的场景——长会话、native 压缩 ≥2 次——一次都没跑过。

## 本轮要做什么

1. S01：登记并收紧 `44e8333b` 的设计偏离（持久化字段只在 derived exposure 成立时确认）。
2. S02：从配对 usage 计算主目标 `fresh-input` 与次要目标，接入 attempts。
3. S03：门改为配对不一致规则 + 3 rep；失败 pair 写进 reason。
4. S04：Q05 精确引用、6.2 候选信号按 plan id 接线、provenance 修正、dirty tree 拒绝交付。
5. S05：Darwin 沙箱经 named volume 上的 unix socket 回到 `--network none`，Key 不落宿主文件。
6. S06：新增 W lane（warm 会话中折叠）与 X lane（长会话多次 native compaction）。
7. S07：干净 HEAD 上跑 84 episode，文档与 `report.json` 同步。

不做：不改折叠参数、不加 `post-compaction-evidence-delta`、不实现 `cold-aligned-fold`（只登记为 6.2 候选，等 W/X lane 数据）。
