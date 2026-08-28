# Autonomous AI Agent Execution Protocol

## 1. 目标

允许没有会话记忆的 AI Agent 从仓库和单个 Task 文件独立完成一个最小、可审核、可回滚提交。

## 2. 唯一真源

1. `tasks/task-graph.json`：依赖与 Task 文件。
2. 当前 Task 文档：允许文件、接口、测试、命令。
3. Task 引用的 numbered specs/ADR/reference public contracts。
4. `artifacts/task-evidence/<dependency>.json`：依赖完成证据。
5. 当前源码与测试；散文不得覆盖已编译公共接口。

冲突优先级：已编译公共 contract + Schema > 当前 Task > ADR > numbered design > examples/reference。

## 3. 调度算法

```text
load task graph
verify requested task exists
verify every dependency status=done and evidence commit exists
verify clean worktree
mark task in-progress with owner/run id
read only task-declared specs/interfaces/source
execute RED → minimal implementation → negative tests → GREEN → full gates
verify changed paths are subset of allowed files
generate evidence
commit once
record commit SHA
mark task done
```

## 4. 严格边界

- 一次只执行一个 Task。
- 不依赖本 ZIP 外部 Skill、聊天记忆或私有知识。
- 不修改 Task 允许集合外文件。
- 不使用 Pi 私有源码 import，不 monkeypatch Pi。
- 不跳过 RED；测试必须因预期缺失行为失败。
- 不自动刷新 golden/fixture 来让测试通过。
- 不以“稍后实现”留下占位符。
- 不在同一 Task 顺手升级依赖、重构邻包或扩展公共接口。

## 5. Blocker 协议

只有以下情况允许停止：

1. 依赖 Evidence 缺失或 SHA 不存在；
2. Task 公开接口与已编译 contract 矛盾；
3. 需要修改允许集合外公共契约；
4. RED 因环境而非预期行为失败；
5. 安全/数据损坏风险使最小实现不成立。

创建 `blockers/Txx-<reason>.md`，记录：证据、最小合同变化、受影响任务、可选方案、推荐决策。状态设为 `blocked`，不得自行扩大范围。

## 6. Review 协议

Reviewer 只检查：规格覆盖、接口一致、TDD 证据、负例、安全边界、文件范围、命令输出和 commit。Review 通过后才能调度依赖任务。

## 7. 并行规则

只有依赖已完成且允许文件集合不重叠的任务可以并行。调度器必须以 `python3 scripts/taskctl.py parallel-ready --json` 的输出作为并行证明；合并顺序必须拓扑排序；公共 contract 任务不得与其消费者并行。

## 8. 完成定义

Task 完成必须同时满足：Evidence JSON 有效、所有 acceptance=true、commit 存在、工作树干净、`taskctl verify-evidence` 通过、依赖任务未被重写。
