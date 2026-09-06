# Posthorse 借鉴改造结果

> 本文是开发阶段的历史记录；后续 gate 修复、2026-09-06 的最终结果和分批提交见 [收口报告](../../../docs/reports/2026-09-06-posthorse-300-gate.md)。文内“未提交”和“未改 gate 参数”描述的是当时阶段。

已合入当前工作树，未提交、推送或发布。开发阶段位于 `/tmp/pi-context-posthorse-opt-20260905`，gate 退出后才整合回主仓库。

## 已完成

- `context_read` / `context_recall` 根据当前容量返回有限页面，包含续读位置；未知 usage 时包含当前 native context，覆盖中文与 Unicode 边界。
- PCR 检索结果不再被自身 tool_result 钩子替换成新指针或再次索引；搜索取消信号贯穿到存储。
- 从已认证、已链接的原始 ingress receipt 重建分支指令；保留输入时间戳和重复输入，压缩不再新增用户 ledger。
- 完整验证后单事务写入 directive/claim 投影，跨 cursor ID 独立，失败零部分投影，重试排序稳定。
- FTS 最近查询缓存按完整 cursor、query、limit 和数据库版本失效；保留取消和结果隔离语义。
- 生产检索预算辅助归入 core；旧 W1 消费者保留兼容路径。

## 验证

当前主工作树：定向单测、五个受影响包的 typecheck、新增集成测试类型检查、打包加载/公开类型验收、包边界和 diff 检查全部通过。实际命令、退出码、日志和 SHA 见 [manifest.json](manifest.json)。

主工作树另已执行产品/宿主验收 21 项全部通过：product-runtime-path 12、controlled-host-compaction 6、recursive-state 3。覆盖一次 overflow retry、副作用不重复、三轮自动压缩、重启/分支切换、完整投影失败重试，以及原有时间戳/重复输入要求。此项记录来源是任务内实际工具输出，不将记录摘要冒充原始日志。

隔离阶段另通过 18 项 contract、snapshot integration 及读写相关验收。只读 review 发现的问题均已修复，最终未发现未关闭 P1/P2。

## 性能与边界

200 条真实 SQLite evidence，同一查询预热 20 次后执行 1,000 次：缓存 11.847 ms，对照 1,020.949 ms，两组结果一致。对照含相同版本检查、每次执行完整 FTS。这是重复查询微基准，不是整体运行时或真实 Provider 提速结论。[原始结果](fts-cache-benchmark-result.json)。可复现脚本保留在 `/tmp/pi-context-posthorse-opt-20260905/tmp/fts-cache-benchmark.ts`。

仍需完整解密并校验 blob；本次限制的是模型返回量，不宣称峰值解密内存下降。Legacy backup/GC/key rotation 需要独立 V2 数据合同迁移，本轮未修改。未切换 Pi fork，未新增无摘要窗口模式，未改 Provider 或 gate 参数。

## Gate 与已有工作

原 gate 日志显示 300/300 后因 `PCR_W2_LIVE_HASH_MISMATCH:canonicalJsonSha256` 于 2026-09-05 18:18:03（上海时间）退出。本次没有中断、重启或修改它的结果；整合前后 report.json SHA 一致。这个历史 gate 不是当前改造的 live 通过证明。

主仓库原有 workflow 删除、benchmark/live lane 修复、controlled-host 测试及既有产物保留。冲突文件已整合其业务要求，并经过独立复核。整合前原文件保留在 `/tmp/pi-context-posthorse-opt-20260905/tmp/pre-integration`，按需可做逐文件回滚。
