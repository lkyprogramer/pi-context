# Lifecycle 与恢复

`session_start` 执行迁移/catch-up/recovery；`session_tree` 按 ancestry 选 generation；`session_shutdown` flush/close。不得从 extension factory 启动 worker。
