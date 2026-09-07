# 05 · 目标架构：Native-First Evidence Context

## 目标与非目标

目标是在官方Pi上降低长任务无效重放的成本，同时使丢失的细节有来源明确、范围受控的回读路径；任何优化失败不能破坏正常输入、图片、分支或工具执行。非目标是构建跨宿主Agent平台、调度子代理、自动无限执行、替代Java LSP或持有跨项目知识库。

本方案是对当前运行时边界的重构，而非要求丢弃所有已有算法和验证经验。[S01–S11](../SOURCE-INDEX.md)

## 架构图

```text
                 Official Pi 0.85.1
  user/RPC ──> native entries + native branch tree
                     │                │
                     │ readonly       │ native compaction/retry
                     ▼                ▼
              Evidence Reader     CompactionEntry
                     │                │
          derived SQLite FTS     bounded capsule (derived)
                     │                │
           pctx_history tool          │
                     └─────┬──────────┘
                           ▼
  native model messages ─> context hook ─> frozen projection ─> provider
         unchanged             │                │
                               │             usage/latency
                          safety bypass          │
                               └──────> original messages
```

## 所有权表

| 资源／行为 | 唯一拥有者 | 插件可做 | 插件不得做 |
|---|---|---|---|
| 用户消息和输入接纳 | Pi | 读取已持久化消息、建立来源引用 | 拦截后自造用户身份、abort图片、吞输入 |
| 会话及分支树 | Pi | getEntry/getBranch读取、授权祖先 | 直接改JSONL、把siblings合成当前历史 |
| 工具执行／参数 | Pi | 观察执行结果、判定回读位置 | 重放命令、重写工具参数、推断缺失exitCode=0 |
| 自动压缩／重试 | Pi | before/after/failure事件，返回可选摘要 | turn_end主动竞争压缩、控制provider重试 |
| 原始证据 | Pi保存的entry | 校验hash、精确字段／范围回读 | 把当前文件当历史原文、承诺恢复从未保存的数据 |
| 索引、搜索片段 | 插件 | 事务写入、损坏重建、分页 | 将派生片段当唯一事实源 |
| 出站工作视图 | 插件，仅公开context钩子 | 只替换安全的旧文本观察 | 修改native记录、丢图片／未知块、破坏call/result |
| 任务状态／成功 | 用户与真实执行证据 | pin明确约束、引用检查结果 | 由摘要文本推断已完成或自动扩大任务 |

## 数据分层

**L0 Native Evidence**：宿主entry及原生附件；这是历史事实，仍可能过期，不等于当前环境。

**L1 Derived Index**：可删除重建的SQLite FTS、来源定位、有限文件／任务标签。它不是新的全量对话日志；必要文本索引有明确隐私代价。启动失败可回退到当前分支的有限直接扫描。

**L2 Working Evidence**：明确pin、未决异常、当前批次、可回读引用。默认不要自动认定一切自然语言都能精确分类为constraint。

**L3 Model View**：原生上下文＋固定epoch的旧观察替换＋固定胶囊。它随请求可丢弃，不是会话状态本身。

## 三种运行策略

`observe`：注册history、建立索引、记录统计；不修改工具结果、context或压缩。初始默认。`off`：不建立新索引，不改上下文，已注册工具返回disabled而不动态变更schema。`balanced`：启用确定性安全投影和原生压缩后的胶囊。`experimental-semantic`：在balanced基础上提供受约束的自定义摘要，需额外用户配置及独立预算。

生产工具schema在会话内固定，不因模式每轮变化。模式切换使generation递增，关闭待提交任务并在下个请求恢复原始视图。切换本身会影响cache，因此需要明确记录。

## 设计上限

不保证模型一定回读，也不保证任意巨型图片／工具输出一定能塞进窗口。若安全规则和硬窗口冲突，保留原始语义、给出可操作诊断，交还Pi原生压缩／用户调整；不以静默损伤换取“绝不超窗”的营销保证。

不声称插件是OS沙箱。其他扩展或shell拥有同一用户权限；来源hash可以发现变化，不能防止恶意本地进程伪造整个历史。边界保证仅限本插件不主动扩大读取范围、不将非授权数据回传给模型。

## 为什么不直接使用完整摘要DAG

Pi已经有原生会话图。再加一个递归摘要图，会引入两套祖先关系、两个压缩调度、更多LLM成本及失效逻辑。先用native branch＋扁平FTS＋小型源引用胶囊能覆盖本用户最关键路径；只有检索消融证明多分辨率导航带来额外净增益时，才增加**派生的episode目录**，仍不替代native事实源。
