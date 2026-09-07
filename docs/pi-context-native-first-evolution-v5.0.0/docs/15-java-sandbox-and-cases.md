# 15 · Java长期任务测试与隔离执行

## 覆盖实际工程，而非记几个字符串

8个核心场景见[cases目录](../cases/INDEX.md)：幂等去重、租户隔离、事务边界、长日志定位、不可重建证据回读、分支／pin冲突、历史测试状态过期、连续压缩后的接口契约守护。每个场景都有输入、操作阶段、隐藏oracle、失败分类和原文恢复触发点。

本包附3个无需第三方依赖的Java8语义fixture，含故意有缺陷的源码及独立oracle；脚本验证基线确实失败和测试安装可运行。它们是校验素材，不是完整Java/Spring业务基准；Spring/Maven集成镜像与Pi驱动由任务T21–T23实现。

## 隔离不能停留在“使用临时目录”

Agent的bash与普通用户同权限；仅换cwd不是隔离。每个arm须使用独立非root容器或同等强度受审查沙箱：只挂载候选工作区rw，工具／依赖只读，grader不挂载，禁止host home、Docker socket和生产配置。强制pids/memory/CPU/wall-time限制，禁止特权和宿主网络。

离线任务预构建包含Node/Pi/JDK/Maven依赖的固定镜像，记录image digest、JDK和Maven版本。镜像运行时rootfs只读、临时目录tmpfs、cap-drop all、no-new-privileges。ARM/x86镜像分别记录，不假设编译产物跨架构。

## 模型访问与工具网络分离

`--network none`下，容器内仅有一个loopback HTTP relay；它通过只挂载的Unix domain socket连接宿主受限provider代理。代理只能访问预先配置的模型endpoint，校验允许的HTTP方法／路径，注入真实provider凭据并执行请求／token／费用预算。真实密钥不写入候选仓库、不进stdout、不交给Agent shell。

Pi使用其正常HTTP provider路由指向容器loopback relay。代理不得提供文件、任意URL、shell或通用CONNECT接口。Agent可能滥用允许的模型接口，因此全局调用／token限制必须在代理外部强制；不能仅靠提示词预算。

这套relay是T21的明确实现任务，不是Pi现成“开一个flag”就具备的能力。能力未验证时保持tools-disabled，报告blocked，不能为了赶出结果绕过隔离。

## 防止oracle泄漏

候选只见task.md、初始源码和公开自测；隐藏测试与正确答案放在宿主grader目录或独立镜像，不挂载给Agent。结束后复制候选输出到grader执行；使用静态allowlist检查禁止改动。测试seed和随机恢复nonce在每次run生成，不写入模型可读的任务metadata。

“hidden”仅是实验隔离含义，不是把测试源码从本用户保密。用户拥有本包全部素材；运行器决定哪些文件不给被测Agent。

## 真实业务扩展

优先加入用户授权的Java旧接口兼容任务、MyBatis租户条件、事务self-invocation、Outbox幂等、数据库只读／禁止跨schema写等案例。不要把生产数据、真实密钥、带个人信息的日志复制进fixture。真实改编任务要标注来源与改编点，同一个模板大量换名不得统计为独立任务。

## 运行产物

每个arm输出run.json、原始provider usage账本、native session、内容脱敏后的trace索引、代码diff、oracle JSON、耗时、结束原因、cache状态和环境指纹。原文trace默认本地保留，不放进公开汇总zip；发布时只输出经审核的可分享部分。
