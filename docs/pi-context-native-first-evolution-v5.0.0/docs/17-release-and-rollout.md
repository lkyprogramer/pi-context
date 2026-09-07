# 17 · 发布、安装与逐级开放

## 发布身份

研发目标包名`pi-context`，初始版本`5.0.0-dev.0`、`private:true`。这是建议的目标，实际npm名称可用性及发布权限未核实。`pi.extensions`只指向编译后的`dist/extension.js`；禁止发布tests、fixtures、旧文档合集、源码密钥和benchmark轨迹。

目标peer固定官方Pi0.85.1，不扩大为未经验证的`*`范围。宿主只作peer/dev依赖，不作运行时生产依赖；采用optional peer或经实际验证的宿主依赖解析方式，防止包管理器自动安装第二份Pi。T01/T19必须检查真实依赖树和loader解析来源，不能只检查peer字符串。Node>=22.19.0。后续版本逐一加入矩阵，而非假设所有未来minor都兼容。没有旧版兼容义务，不代表可以忽略发布依赖和实际安装路径。

## 安装体验验收

由T01/T19在干净临时HOME／agentDir中验证官方Pi安装、插件tarball或官方资源加载方式、reload、session恢复、卸载。若使用Git源安装，Git包必须具备Pi可加载的构建产物或文档化构建流程；不能要求用户手改node_modules。

最终用户只做正常的Pi包安装／启用和必要配置，不需要clone官方fork、打patch或注入自定义常量。具体公开安装命令必须取自**该次验证的Pi CLI help／文档**并附日志后写入最终README；本设计包不把尚未生成的npm包写成已可下载。

## 发布阶段

阶段A：observe-only内部试用，G0/G1/G2通过。阶段B：balanced显式opt-in，G3与代表性E2E通过，清楚标为有限样本。阶段C：满足预注册统计／资源门槛后可推荐balanced。阶段D：B3消融通过才单独发布semantic实验能力。

每级输出：源码commit、锁文件hash、包SHA256、宿主版本、官方是否未修改、测试JSON、失败清单、未覆盖范围、指标可解释性。环境阻断为incomplete，不改为pass。拒绝“某个npm script exit0就发布”，还应核对它实际执行了哪些测试。

## 回滚演练

长会话中先observe，再balanced，触发一次native压缩，关闭插件并继续原任务；验证旧native记录完整，工具调用没有被重放，关键约束可通过原生summary/history路径继续找到。插件辅助capsule不再出现是预期，不能破坏基础会话。

对每个可安装发布物执行clean-install、load、RPC任务、compact、resume、uninstall全链路。只跑源码import、打包dry-run、开发机缓存环境都不够。

## 发布权限

开发Agent没有自动公开发布权限；不得npm publish、创建GitHub Release、push main或上传原文轨迹。用户授权后由既定发布流程执行。代码中保留private:true直到明确批准，测试环境也不能关闭这个约束。
