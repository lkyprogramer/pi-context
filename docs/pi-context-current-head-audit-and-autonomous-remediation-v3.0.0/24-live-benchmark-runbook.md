# Live Benchmark Runbook

1. 确认 clean worktree；
2. 记录 HEAD、package digest、Pi patch digest、Node/OS、model/provider；
3. 冻结 corpus/scorer/config；
4. 建立 runEpoch；
5. 为每个 pair 克隆相同初始 workspace；
6. 运行 B0/B1/B2/F0；
7. 每个 stage 原子落盘；
8. Transport retry 不超过 2 次；
9. 完成后生成 bytes/canonical 双哈希；
10. 离线复算 report；
11. Gate 从 report 生成 decision；
12. Raw bundle 经 secret scan 后上传为 Actions/Release artifact；
13. Git 只提交 manifest、summary 和 digest。
