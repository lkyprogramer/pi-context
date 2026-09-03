# Task Evidence v3 治理

任务完成必须同时满足：

- 依赖任务已完成；
- RED 证明目标缺陷存在；
- GREEN 命令 exit 0；
- Full Gate exit 0；
- 当前 HEAD 等于 evidence.headCommit；
- 日志和 artifact 哈希可验证；
- 变更文件属于 allowedFiles；
- Finding 验收断言全部为 true；
- Reviewer 记录 `accepted`。

只存在 `evidence.json`、只跑 narrow test、或 Agent 自述成功都不能变更任务状态。
