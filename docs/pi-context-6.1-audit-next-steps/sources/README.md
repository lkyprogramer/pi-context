# 来源与核验范围

研究截至2026-09-09。主依据为附件与固定main源码，另经GitHub connector核对commit、workflow、关键文件。不是重新复现社区性能榜。上轮社区/Posthorse取舍继续作为背景，不将未重新测量的README数字当本轮收益。

|来源|固定引用|用途|
|---|---|---|
|用户仓库|[main快照](https://github.com/lkyprogramer/pi-context/tree/7478307ead72e849e9c619a913858afe8a06d38b)|源码、test、eval/local与现行文档|
|最新自报|[迭代报告](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/docs/iterations/native-first-v6.md#L121-L139)|37/37、prefill比和已披露限制；无该run raw文件|
|运行入口|[plugin.ts](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/src/plugin.ts#L203-L281)|全history规划、render前计量|
|Agent沙箱|[run-agent.sh](https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/eval/local/sandbox/run-agent.sh#L15-L83)|真实Key写入agent config与bridge网络|
|Required CI|[run34322042128](https://github.com/lkyprogramer/pi-context/actions/runs/34322042128)|当前失败但typecheck/packed通过|
|Compatibility|[run34322042110](https://github.com/lkyprogramer/pi-context/actions/runs/34322042110)|旧workflow残留；不逐cell推测失败根因|
|官方Pi usage|[openai-completions.ts](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/ai/src/api/openai-completions.ts#L1490-L1549)|input已扣cacheRead/cacheWrite，reasoning已含output|
|官方Pi compaction|[compaction.ts](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/src/core/compaction/compaction.ts)|Native仍作为fallback与会话owner，不移植Fork|

每个被审计本地文件的SHA256与行数见`evidence/inspected-files.json`。链接定位只对指定commit有效。本包source-probes不包含外部Provider网络，也未运行完整Pi宿主；latest报告属于项目自报，不能混成独立执行证据。
