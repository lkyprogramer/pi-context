# Benchmark Task Execution Protocol

1. 一次只执行一个 Bxx Task。
2. 开始前验证依赖 Evidence 和工作树。
3. 只能修改 Task 列出的文件。
4. 必须完成 RED→GREEN→负例/故障→全局门→Evidence→原子 Commit。
5. RawTrace、Oracle、Run Artifact、Golden 不得自动刷新。
6. 发现公共合同变化时创建 blocker，不得跨 Task 偷改。
7. Gate Task 不得编辑输入数据、阈值或运行结果。
8. Reviewer 必须重跑窄测试和一个随机 Scenario replay。
