# H03 · 262k 真实长会话 dogfooding（观察性）

一个会话、balanced、`w262k`、`--no-sandbox`（在宿主用平时的 pi，或用 `run-episode.mjs --case H03 --arm balanced --window w262k --no-sandbox`）。工作区：把 `fixtures/L01..L06` 六个 `initial/` 复制到同一临时目录的 `t1..t6` 子目录，并用 `scripts/gen-logs.sh` 在 `logs/` 下生成 12 个各 2500 行的合成 Maven 风格日志（每个约 200 KB，Pi 截断到 2000 行/50 KB）。

prompt 段落顺序（每段等 `agent_settled`）：

1. `Work in t1/: <L01 TASK.md 原文>`
2. `Before continuing, run: cat logs/build-01.log and cat logs/build-02.log — summarise in one line whether they show a successful build.`
3. `Work in t2/: <L02 TASK.md 原文>`
4. `Run: cat logs/build-03.log && cat logs/build-04.log — one-line summary.`
5. `Work in t3/: <L03 TASK.md 原文>`
6. `Run: cat logs/build-05.log && cat logs/build-06.log — one-line summary.`
7. `Work in t4/: <L04 task 原文>`
8. `Run: cat logs/build-07.log && cat logs/build-08.log — one-line summary.`
9. `Work in t5/: <L05 task 原文>`
10. `Run: cat logs/build-09.log && cat logs/build-10.log — one-line summary.`
11. `Work in t6/: <L06 task 原文>`
12. `Run: cat logs/build-11.log && cat logs/build-12.log — one-line summary.`
13. `Which of the twelve logs contained the string FIRST-ERROR-MARKER, and on which line? Quote the line.`（其中恰有一个日志在第 1700 行左右含该标记；生成脚本把它写入 `.marker.json` 供判题；不在 prompt 中给出是哪一个）

预期用量：六题各 ≈ 12–18k + 12 个截断日志各 ≈ 12k ≈ 200k → 在 ≈157k（60%）处触发一次折叠，最后一段迫使模型对已折叠的日志做回读（或承认无法回答）。

记录（`/pctx status --json` 与 telemetry jsonl）：
- 每请求 `input/cacheRead/output/contextPercentBefore`；
- 折叠触发时的 percent、`replacements`、`savedTokensEstimate`；
- 折叠后第一条请求 `cacheRead`（预期 ≈0）与其后恢复；
- `nativeCompactions`（预期 0；若发生，记录在第几段与当时 percent）；
- 第 13 段：`historySearches/historyReads/verifiedReads` 与回答是否正确（对照 `.marker.json`）；
- 六题各自 verify/Oracle 是否通过（顺手判，不进质量门）。

不进质量决策；进机制门与成本门（协议 §决策规则 3）。
