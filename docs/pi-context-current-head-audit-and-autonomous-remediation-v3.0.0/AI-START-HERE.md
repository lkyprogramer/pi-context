# AI-START-HERE

## 执行策略

从 `C01` 开始，不要先跑新的 Live 长基准。当前源码无法 strict compile，任何更长实验都只会制造不可发布证据。

### 每个任务

1. 建立独立 worktree；
2. 读取对应 task 文件和 Finding；
3. 运行 RED；
4. 实施最小改动；
5. 运行 Narrow GREEN；
6. 运行任务 Full Gate；
7. 生成 Evidence v3；
8. 运行 `python scripts/taskctl.py complete Cxx evidence/Cxx.json`；
9. 代码审查；
10. 小提交合并。

### 禁止

- 修改测试门槛让红变绿；
- 把 timeout 样本删除；
- 用 B1 结果宣称 B2 产品收益；
- 用 Hermetic 结果关闭 Live Finding；
- 在 Required/Compatibility 红时运行 Publication；
- 在 branch protection 关闭时标记 C31 完成。
