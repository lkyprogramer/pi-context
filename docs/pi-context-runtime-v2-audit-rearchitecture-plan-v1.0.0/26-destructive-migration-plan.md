# Destructive Migration Plan

本计划不保留旧内部 API、旧 SQLite Schema、旧 checkpoint 或旧 synthetic Gate compatibility。

## 执行

1. tag 当前 commit 为 audit baseline；
2. 删除 app Composition Root 和不可靠 E2E；
3. 新建 schema v2 和独立 data root；
4. 旧 `.pi-context` 数据不自动导入；
5. 用户需要历史时，提供只读 `legacy-export` 工具，输出 untrusted source documents；
6. 新 Runtime 从新 session 或显式 replay 开始；
7. 所有旧 checkpoint 只作为 `agent-derived/untrusted` evidence，不生成 active directive/claim。
