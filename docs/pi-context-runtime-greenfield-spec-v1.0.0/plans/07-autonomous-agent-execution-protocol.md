# Autonomous Agent Plan Consumption

1. 读取 `tasks/EXECUTION-PROTOCOL.md`。
2. 使用 `scripts/taskctl.py next` 选任务，不自行选择未就绪任务。
3. Task 是唯一可执行规格；Wave Plan 是调度与 Gate；Master Plan 是全局约束。
4. 每个 Agent 的输入包：repo、Task 文档、依赖 Evidence、引用规格、task-status。
5. 每个 Agent 的输出包：一个 commit、Evidence JSON、RED/GREEN/full-gate 日志、blocker 或完成状态。
6. Reviewer 必须是新的执行上下文，不依赖实现 Agent 的私有推理。
7. 不允许一个 Agent 连续实现多个 Task 后一次性提交。
