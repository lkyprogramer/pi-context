# AI-START-HERE

## 执行策略

仓库根 `AGENTS.md` 是日常开发规范。本文档只约束发布/审计路径，不应阻塞普通开发。

普通开发从当前任务和直接相关代码开始。只有进入真实 Live、300 gate、发布包、数据库/数据迁移、安全敏感改动、准备发布/部署，或用户明确要求 Evidence v3 时，才按下述审计流程执行。

### 审计任务

1. 确认任务属于发布/审计路径，再建立独立 worktree；
2. 读取对应 task 文件和 Finding；
3. 运行 RED；
4. 实施最小改动；
5. 运行 Narrow GREEN；
6. 运行任务 Full Gate；
7. 完成规格和代码 review，确认 reviewer accepted；
8. 按 review 结论更新并封存 Evidence v3；
9. 运行 `python scripts/taskctl.py complete Cxx evidence/Cxx.json`；
10. 一个完整 W 或审计批次完成后统一提交。

### 禁止

- 修改测试门槛让红变绿；
- 把 timeout 样本删除；
- 用 B1 结果宣称 B2 产品收益；
- 用 Hermetic 结果关闭 Live Finding；
- 在 Required/Compatibility 红时运行 Publication；
- 在 branch protection 关闭时标记 C31 完成。
