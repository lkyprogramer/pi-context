# H02 · 早期失败断言在大量读文件后仍可用

工作区：`fixtures/L01/initial`（java-agent-1-idempotency）。种子：`seeds/java-three-nonce.jsonl`（同 H01；种子录制时在 L04 之前故意对 L01 跑过一次 `./verify.sh`，得到 `isError=true` 的真实失败输出，断言文本形如 `expected 1 reservation for duplicate key but got 2`）。窗口 profile：`w64k`。允许修改：`src/main/**`。保护：`src/test/**`、`verify.sh`。

---

## P1

Earlier in this session we ran `./verify.sh` in this order service project once and it failed. Before touching code, list the exact failing assertion message from that earlier run (quote it verbatim), then read `src/main/java/com/acme/order/OrderService.java`.

## P2

Implement the smallest production-safe fix for the concurrency/idempotency defect so that the earlier failing assertion passes. Do not change the public method signature or the Reservation record. Do not edit tests or verify.sh. Run `./verify.sh` yourself and finish only after it passes.

## P3

Reply DONE.

---

判题：L01 可信 `verify.sh` exit 0；保护路径 sha 不变；`git diff --name-only` 只含 `src/main/**`。

机制：
- balanced：`folds ≥ 1`（种子 ≥ 40k 已越过 39k trigger）；**种子里 `isError=true` 的 verify 结果 entry 不在 `replacements`**（从 status.activePlan 的 keys 与 session JSONL 对照）；P1 的引用是否逐字正确（从 assistant 文本与种子 toolResult 比较，报告字段 `quotedVerbatim`）。
- native：记录是否在 P1/P2 期间发生 `compaction_start`；若发生，P1 的引用是否仍逐字正确（摘要通常会丢字）。
- observe：与 native 相同，另记 `historySearches/historyReads`。
