# CI与安全：哪些应修，哪些不应恢复

## 当前远端CI

HEAD7478307的required(34322042128)与compatibility(34322042110)失败。但frozen安装、typecheck、packed-install-hermetic已经成功。unit原始日志为 `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "test:unit" not found`；多个Job仍引用归档前的tests/packages和旧脚本。

结论是**CI没有随单插件迁移**，不是“当前严格编译又坏了”。R01仅保留两条有意义的检查：当前check和真实Pi packed smoke；不要恢复已经删掉的旧命令以假装兼容。个人仓库分支保护是可选治理，不作为算法验证先决条件。

## 容器化判题的进步

当前grade.sh对候选只读、network none、cap drop，优先复制可信fixture，再覆盖允许编辑文件；可信verify/Oracle在隔离容器内执行。当前应保留，不重复开“把Java判题移入容器”的旧任务。

## 新/残余安全断点

Agent侧run-agent.sh将父进程真实Key写进挂载的models.json，并chmod整个work/agent/out可读写；Agent拥有read/bash，可直接读取该文件。bridge并不是出站白名单。H03在宿主运行，改HOME只改变默认路径，不是文件系统或进程隔离。

修复用已有父进程Broker，不新增平台：Agent只见临时run令牌，broker固定目标模型、上限和路径；真正Key不进入任何挂载、env、prompt、日志。全部tools-enabled任务在network-none容器，通过Unix socket forwarder访问broker；grader无socket。用随机假key canary证明不可读，不用真实key做泄漏测试。若本轮运行过这条真实Key路径，建议轮换该测试凭据；本次未观测或重放任何真实泄露。

### 判题剩余边界

outsideEditable检查不能仅遍历候选现存文件，否则删除未授权原文件不计；symlink不应直接skip；允许忽略的.class必须固定在manifest里，不能运行后选择。构建配置/Oracle始终可信来源，Agent不能修改结果文件以影响判题。模型可写的status/events不能单独作为gate真相；受控Provider/父进程receipt交叉核验。

不要求新增K8s、远程构建、沙箱平台或多租户授权。R06只复用现有Docker/Unix-socket broker，把两类进程边界走完整。
