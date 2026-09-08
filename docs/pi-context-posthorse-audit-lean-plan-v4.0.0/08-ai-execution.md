# AI自主执行：一个待办队列，不再造流程平台

## 执行规则

读取README、06设计、CONTRACTS及当前任务；以 `tasks/index.json` 的dependsOn找ready任务。默认单Agent顺序执行。只有不修改相同文件的评分与存储测试可并行；所有composition-root改动串行。无需superpowers等外部Skill或私有执行器才能运行本计划。

每个任务完成标准：**具体RED复现 → 最小实现 → 同一RED变GREEN → 对应边界负例 → strict typecheck → 一次本地commit**。已有正确行为不为满足RED要求故意破坏；写缺失边界测试即可。禁止降低threshold、删除失败、给答案预灌Store或把Provider调用替成固定答复后叫Live。

每Task只保存一个 `artifacts/lean-v4/tasks/Txx.json`：taskId、baseCommit、代码提交后的另存commit关联、命令/exit、关键测试路径和断言、未覆盖项。必要日志放同目录。避免把当前commit的hash写进自身提交造成循环；可在后续总run manifest记录commit，或把task receipt作为未提交本地文件。

## 三段顺序

| 段 | 任务 | 退出条件 |
|---|---|---|
| A 产品事实链 | T01→T02→T03→T04 | 认证fixture正确；祖先可读、兄弟不可读；输出不只pointer；工具事件不删 |
| B 可测产品 | T05/T06/T07/T08/T09/T10/T11 | 用量与观察可区分；来源安全；小语料有实际文件；模式边界明确 |
| C 集中验收 | T12 | 本地全验收+预算受限Live或明确blocked；生成诚实决策 |

不要继续逐项追逐C00–C31的大发布门；本包替代后续路线。已经修好的组件复用，不重写。

## 允许自动做的事

本地临时worktree/测试库、写源代码和测试、运行无Provider测试、生成本地commit、构建tarball、读已有报告、在明确PCR_LIVE=1且凭据隔离/预算预检通过时跑一次指定实验。

## 不允许自动做的事

推送/发布/npm publish、改GitHub保护规则、安装/更换系统Pi fork、把真实密钥写manifest、删除用户数据、联网工具越出实验sandbox、扩大模型开销或自动改判分门、为了让结果好看不断重跑相同失败。

外部权限缺失时产生 `artifacts/lean-v4/BLOCKED.md`，写清命令、错误类型、已完成部分及唯一人工前置。随后继续其他无依赖ready任务；不要无限重试。实在没有待执行任务时停止，不伪造完成。

## 可复用失败分类

`environment-blocked`（依赖/网络/host不匹配）、`source-defect`、`fixture-defect`、`scorer-defect`、`provider-timeout`、`task-failure`、`evidence-missing`、`safety-stop`。不同类别不能互相豁免；例如Fixture修好不证明产品质量，Provider超时不因“基础设施”一词就从分母删除。

## 变更纪律

允许任务内必要类型贯通，但超出Allowed Files先记录理由并更新任务边界；不要顺手合并旧包、换schema体系、增加背景Agent。每个接口只有CONTRACTS一份权威定义；各Task代码为关键RED示例，完整正负例按验收表补齐。总验收只在T12跑一次完整矩阵，不要求每个小任务付同样成本。
