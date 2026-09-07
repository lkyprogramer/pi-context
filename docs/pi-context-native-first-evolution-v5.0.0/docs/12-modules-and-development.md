# 12 · 模块边界与开发组织

## 单一可安装包，独立评测目录

```text
src/extension.ts                 唯一公开扩展入口
src/pi/adapter.ts                公开Pi hook接线，不含策略
src/pi/source-reader.ts          native entry读取与来源映射
src/pi/lifecycle.ts              generation与shutdown
src/history/scope.ts             作用域及祖先授权
src/history/refs.ts              来源ref／hash／游标
src/history/index.ts             索引接口、降级扫描
src/history/sqlite-worker.ts     SQLite与FTS事务
src/history/search.ts            搜索、排序、分页
src/history/read.ts              精确回读与图片
src/projection/exposure.ts       成功请求暴露跟踪
src/projection/batches.ts        call/results完整性
src/projection/planner.ts        可删区域与epoch
src/projection/render.ts         纯函数输出克隆
src/projection/cache.ts          缓存代价与证据标记
src/projection/budget.ts         最终预算、估算等级
src/checkpoint/pins.ts           native custom entry重建
src/checkpoint/capsule.ts        确定性胶囊
src/checkpoint/validator.ts      来源／断言校验
src/checkpoint/semantic.ts       可选单次摘要
src/checkpoint/staging.ts        stage/ACK/失效
src/config.ts                    配置及信任边界
src/commands.ts                  /pctx与history注册
src/telemetry/usage.ts           provider账本
src/telemetry/metrics.ts         不含正文的指标
src/telemetry/redaction.ts       诊断脱敏
src/contracts.ts                 从本包规范收敛的内部类型
src/testing.ts                   仅测试fixture工厂，不进发布包
scripts/                         构建、packed-host、协议检查
 test/                           unit/property/host/security/fault/packed
 eval/                           测试运行器和评测，不被插件import
```

不要仅把原来10个包移进10个子目录后保留所有转发层。一个模块只有一个明确的事实源，只有在多个实现确实存在时才抽象接口；不为未来宿主先设计provider-agnostic runtime。

## M1–M4与任务DAG

任务见[目录](../tasks/INDEX.md)及`tasks/task-graph.json`。M1完成官方宿主、来源及只读history；M2完成暴露与投影；M3完成胶囊、真实闭环及发布；M4才实现可选语义proposal staging与生成，并单独验证；核心不会提前携带一套未使用的摘要状态机。

每个任务提供文件写入范围、依赖接口、失败测试、最小实施步骤、精确验证命令、边界和证据产物。任务不是“写一个完善模块”这样的抽象口号。执行者先写RED测试，再实现，最后运行该任务和依赖门禁；跨任务变更契约必须更新相应任务并串行合并。

## 并行方式

单个协调Agent管理DAG和公共契约。scope/index可以在契约冻结后与batch/budget并行；同一个文件只能一个writer。实现Agent不得决定其自身验收结论，review Agent只读diff和真实运行证据。没有可用子代理时按相同DAG串行执行，不伪造“已经独立review”。

建议独立Git worktree。自动化只可创建自己的分支和临时目录，不得force push、清除用户工作树、修改全局Pi安装或发布npm。所有合入以本地证据和用户项目政策为准。

## 删除旧模块的顺序

先新增v5非侵入入口并验证官方宿主；再切换根安装入口；迁入旧故障样本而非旧内部API；最后删除旧生产packages和patch配置。每一步都必须能证明off/observe不会改变原生消息。

不用为旧数据做迁移，也不自动清理它。原有测试可以作为历史回归材料，但依赖PCRpatched host的测试应明确归档，不能让它们阻止取消补丁这一目标。
