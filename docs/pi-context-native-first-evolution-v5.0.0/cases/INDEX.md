# Java与长任务场景目录

| 场景 | 内容 | 本包材料状态 |
|---|---|---|
| [J01](J01.md) | 多租户幂等键与不可变约束 | java-fixture |
| [J02](J02.md) | MyBatis式租户条件不得漏加 | java-fixture |
| [J03](J03.md) | Spring事务self-invocation与回滚 | planned-spring |
| [J04](J04.md) | 长Maven日志中的首个因果错误 | planned-maven |
| [J05](J05.md) | 不可重建nonce的真实历史回读 | planned-live-recovery |
| [J06](J06.md) | 分支约束冲突与pin生命周期 | planned-host-live |
| [J07](J07.md) | 旧测试通过不等于当前修订通过 | java-fixture |
| [J08](J08.md) | 连续压缩后保持旧接口契约 | planned-java-migration |

3个java-fixture可用`python3 scripts/verify_java_fixtures.py`验证有缺陷基线RED及已知正确版本GREEN；其余5个场景是完整任务规格，由T21–T23实现真实Pi/模型驱动。所有live场景本次均未执行。
