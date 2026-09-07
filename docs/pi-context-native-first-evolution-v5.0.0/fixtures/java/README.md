# Java8语义验收素材

J01、J02、J07每个包含故意有缺陷的initial、外部Oracle及已知正确的参考版本。执行`python3 scripts/verify_java_fixtures.py`会在临时目录编译，并验证初始版本RED、已知正确版本GREEN。

真实Agent测试只挂载initial与任务说明，**不要把grader、KnownGood或本包整个目录挂入候选工作区**。Oracle是对基准自身的校准，不是对pi-context的效果验证；实际Pi／模型驱动由T21–T23实现。参考正确代码仅用于校准测试，不作为现有业务系统完整实现。

需要支持`javac --release 8`的JDK。脚本只处理本包自带固定fixture，不是执行任意不可信Agent代码的沙箱。
