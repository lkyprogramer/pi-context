# 本地补测与修复记录

> 历史记录（2026-09-06 归档）：下文描述当时的候选和计划，不代表当前主工作树或后续 Provider 测试已通过。压缩 backfill 方案已被已链接 ingress receipt 投影替代，当前总结见 `docs/reports/2026-09-06-posthorse-300-gate.md`。一次性 `run-supplement-live.sh.txt` 原样留档，依赖原隔离目录中的补丁和快照，不作为通用脚本入口；遗留 status.json 的 running 字样不能替代完成证据。

本轮基线：`ba25c24b4fe4ad05744b336d087f39ea645a3347`；Node `v22.19.0`。
隔离候选：`/tmp/pi-context-supplement-20260905`。源码及补丁绑定见 `source-snapshot.json`、`changes.patch`、`evidence.json`。本轮没有提交、推送或发布。

## 已完成

- 真实 Pi AgentSession + 产品扩展 + 受控 Provider：自动 overflow compact/retry、持续 overflow 只重试一次、同轮工具副作用只执行一次、助手文本不能回填为用户指令、真实重启和树分支、三次自动插件 checkpoint。
- 修复 compact backfill 的跨轮身份冲突。身份使用源 timestamp、cursor、内容与同组 occurrence；保留原始输入时序；同文不同时间分别保存；同一 preparation 加入无关助手消息后重入不新增 ledger 行；无 timestamp 时拒绝 authenticated backfill。
- 自然压力 runner 现在检查实际 JSON 答案及包括最终问答的所有请求输入上界；input/cacheRead/cacheWrite 任一未知都不标 bounded；不要求 B2 必须产生 Host compaction。
- 递归 runner 在每周期最多40轮内等待自动 checkpoint，不再只增长一轮；三周期必须全部来自插件，不能用 Native fallback 充数。
- 两个真实 Codex 开发片段已忠实脱敏规范化，分别为超时修复、移除云端Live任务；它们归入 `benchmarks/corpus-v3/dev`，同一来源会话 cluster，不是独立 holdout，也不是原生Pi会话。

## 验证

| 检查 | 实际结果 |
|---|---|
| 九个定向单元测试文件 | 43项通过；更新后的W5/closed-loop另行重跑 |
| 最终W5/closed-loop | 2文件16项通过 |
| 最终产品验收（含新增受控Host与来源身份测试） | 3文件18项通过 |
| contract | 10文件38项通过 |
| recovery integration | 4文件11项通过；所列saga-store被lane配置排除，未算入该结果 |
| typecheck | 通过 |
| packed | 19/19历史于本轮较早版本通过；最终时间戳修复后，受影响clean-install再次1/1通过 |
| dev corpus形状和脱敏 | 2个case可解析；11个文件secret scan无命中；仍拒绝解除C22 real-traces门 |
| 只读独立review | accepted；仅覆盖代码与受控证据，不覆盖尚未完成的target Provider结果 |

中间失败日志保留：最初pack遇到沙箱外npm cache写入失败，改用`/tmp` cache；时间戳收紧后packed fixture缺少合法timestamp，补齐fixture后clean-install通过。没有放宽断言。

## 已启动的后续任务

受管执行会话 `4713`，脚本PID记录：`/tmp/pi-context-supplement-20260905/artifacts/supplement/live-followup.pid`。

当前状态：等待原300 gate PID `61786` 退出，以避免并发使用同一Provider。之后脚本会核对候选源码hash和主工作区目标文件基线；只有完全匹配才应用已审查的补丁。任何目标文件变化都停止，保留补丁供人工整合。

然后串行执行 natural、recursive-auto、overflow。每项保留独立日志与原始session/report，失败也保留。实时状态：

`/tmp/pi-context-supplement-20260905/artifacts/supplement/target-provider/status.json`

这些实际Provider测试尚未完成，本记录不预判成功。目标模型的质量、C22独立真实holdout及C24 300 gate仍未验收；`publicationClaim=false`。
