# 安全、实验环境与个人使用

## 1. 先处理已进入日志的真实凭据

最新报告明确记录本地Provider凭据进入原始session/raw与SQLite，事后对提交副本脱敏。[S2] 本包不列出密钥值，也没有证据表明已被外部盗用。进入模型上下文和原始日志仍应视为暴露面扩大：轮换相应凭据、限制旧日志访问、停止把auth/models直接放到Agent可读目录。已经提交的摘要无精确命中不表示所有历史或日志安全。

## 2. 为什么临时cwd不够

现Runner复制 `~/.pi/agent/models.json` 和auth.json到arm目录，但read/bash通常能读绝对路径、用户HOME和环境变量。单独cwd既不是文件系统隔离，也不是网络隔离。把API key放环境变量再启用bash并不更安全。

无凭据开发全部用本地受控Provider。真实tools-enabled验收必须由宿主外部的凭据代理访问服务，Agent侧只有短期无价值token或受限loopback端点；文件系统隔离不映射宿主HOME、auth/models、SSH或runtime私密原件，网络出口仅允许代理与fixture。代理日志只记请求ID/计量/错误类型，不记auth header。没有可用隔离时停止tools-enabled live，不以危险裸跑换取“自动执行”。Reader-only无工具可以先跑，标签必须相应降低。

## 3. 信息分类

raw evidence允许加密本地存储，但来源中有真实credential时应在送入模型/FTS/receipt前执行统一scrub。被scrub的模型视图和原件不同hash；工具精确读取须应用权限/secret策略，不能因exact就无条件返密钥。用于精确恢复的合格fixture仅使用合成非敏感内容。

报告包默认只含结构化断言、计量、脱敏完整回答、允许的源quote、模型/配置指纹、哈希清单；原始DB/密钥永不自动上传。完整回答需要独立secret扫描，不能只保留400字符而丢失评分证据。扫描器自带合成canary负例，覆盖日志、JSON、tar成员、SQLite导出的可见文本；此扫描不声称覆盖未知秘密。

## 4. 支持的宿主

当前PCR依赖patched Pi0.84.4，补丁hash `aafdfb29c4ce78146bd96cabb48d0e3cef032fd81cc17ee6acbc85c6bea584c5`；核心作用是认证输入metadata。不得再写“任何stock Pi都能装”。主机补丁由现有pack/compat工作流验证；本轮不换Posthorse fork。

起始Node选择本项目已测22.19.0。另一个用户目标平台做一次集中pack验收即可；未测试的新版本标unverified，不使用星号版本声明长期保证。

## 5. 三种产品profile

- off：不注册修改型hook。
- ingress（默认，T11实现）：保留Native compact及原请求历史；工具降噪采用短输出保真，长输出有界+可读句柄；观察失败有明确降级。
- experimental-runtime：额外checkpoint/materializer/按需Recall；启动时明确实验性；只对通过当前场景验收的会话启用。

报告decision只用于建议，不自动修改全局配置。回退通过禁用扩展/选ingress而不是修改用户原始session日志。近期日志和原始CAS保留到本次迭代验收完成；生产GC/key rotation属于单独运维功能，未完成不能宣称具备。

## 6. 精简CI

常规push只需锁定环境的fast/local关键检查。管理员治理如Branch Protection单独显示，不把缺少token写成成功；也不让个人功能修复被治理权限阻塞。云CI只跑无真实Provider的验收，不存用户密钥。真实模型实验在本地显式授权且有总预算；每次只有一条权威run目录。
