# 可复用测试方法：三个层次、一次集中验收

## 层1：无需LLM的快速正确性

每个任务只运行相关测试+严格类型。必须覆盖如下不变量：

| 类别 | 必测正例 | 必测负例 |
|---|---|---|
| 观察投影 | 短结果逐字；长失败日志保留错误/exit/path | Reducer异常、无法落盘、只返回pointer |
| 消息完整性 | 两个不同call相同OK仍全部保留 | orphan、缺result、同ID重复投影 |
| 访问边界 | 当前head读取祖先、共同祖先、重启后读取 | 兄弟新事件、foreign session/workspace、伪entryID |
| 类型化原文 | text、多块、image完整hash/分页 | 块类型未支持不得静默丢；UTF中间offset拒绝 |
| 评分器 | 正确引用checkpoint、明确目标版本 | 先否定后允许、伪tool call、未知当答案 |
| 数字与报告 | 0恢复样本=not-tested；missing成本=null | 拿N/A当1、拿最后input当total、重复pairID |

五个恢复fixture必须真实经生产Tool Hook写入，禁止测试预先直接向Store喂期望答案：文本日志、UTF8、多块/图片、追加消息后、重启/模型切换后。每个均校验contentHash和原始字节/封装，错误分支必须拒绝。scope拒绝不应导致正常祖先也拒绝。

## 层2：本地集中产品验收

T01创建 `pnpm check:local`，整合现有typecheck、unit、contract、integration、acceptance、packed；避免同一文件跨lane反复执行。这里用受控Provider验证协议，不调用用户付费模型。模式必须标明 `controlled-provider`。

至少有两次真实append后回读、真实Pi session restart、兄弟branch隔离、一次强制context-length错误、最多一次重试且外部副作用不重复。手动compact可验证可重入，但不能写成自然自动压缩。压测模型窗口可在受控Provider取小值加速，必须标注不能替代200K目标服务性能。

安装验收必须从最终tarball、空Pi Home启动，锁定认证补丁hash；不可从monorepo源码导入代替安装证明。测试能区分stock不支持与patched支持，不导入宿主私有路径。

## 层3：小规模真实任务净值实验

固定 **12个独立任务 × 2次重复 × B0/B2两臂 = 48臂**。这是新的个人试用Gate，不追认旧100×3。每臂最多8个模型请求（含该臂压缩/回读/重试），单请求180秒，整臂600秒；全部最多384请求。T12须读manifest中的更小预算优先执行，预算到限即停止并报告未覆盖。预算是上界不是执行承诺；在用户配置未授权Live时只做预检。

12个任务分为4个Java/TypeScript修复、2个需求更正、2个长日志定位、2个延迟精确事实读取、2个branch/restart恢复。至少4个中文/中英混合；任务必须来自不同独立源，参数换ID不算独立。确实没有12条真实来源时保留合成/改编标记，只用于smoke，不擅称holdout。

### 因果隔离

- 产品主比较：**B0 = Native + 与B2相同安全Ingress；B2 = 同Ingress + PCR checkpoint/materializer/read**。两边都不泄露凭据。另做少量A0/A1测Ingress收益，不重复四臂全矩阵。
- 未改变窗口/模型/输出预算；同工具schema、system、同一预切点和retained tail，fork/补丁锁定。不同arm具有独立临时Pi Home、工作区与副本Store，逻辑来源IDs等价。
- 奇偶repeat轮换B0→B2、B2→B0；单并发目标模型。记cache配置和进程是否复用，不能用顺序不同解释成算法确定优势。
- 真读写Coding必须有实际workspace snapshot与测试命令；Reader-only问题禁工具且明确是“目标版本”还是“历史观测”。
- B1只用于诊断checkpoint与materializer分别影响；F0只在失败任务需要定位Reader/Executor能力时运行，不让可选诊断影响主比较分母。

### Ground Truth

每个题的oracle保存source事件范围、quote/hash、kind（requested-target/observed-state/permission）、expected和环境断言。原始问法与判分不能矛盾。已执行成功只认工具退出码与产物，Assistant说完成不算。

断言配置和原始测试文件hash保存在Agent不可写的runner侧；不能只在任务仓库里放可被修改的测试。

Coding以真实环境评分：目标文件存在、测试exit=0、Git diff允许范围、public API声明未变、禁用动作计数0。每个外部副作用用本地模拟服务，禁止真实部署、支付、发信。

## 指标与统计

1. **Integrity门**：批次/授权/原文恢复必须通过；任何凭据泄漏立即停。
2. **Task结果**：配对成功率均值差及discordant表；失败/超时留ITT分母；completion单列。按独立任务cluster bootstrap，repeat嵌套在cluster里。小样本报告区间，但不证明2%非劣。
3. **效率**：每任务所有请求input/output/cacheRead/cacheWrite总量；uncached/cache split来源必须说明；compact等待、整任务wall clock、工具回读次数另列。金额价格未知时null，不能按0报免费。
4. **恢复**：eligible、attempted、passed、denied-wrong-scope分别计数；n=0为not-tested，最低fixture覆盖未满足即inconclusive。
5. **Cache**：相同逻辑请求条件下比较；不能把缓存命中导致的input降低说成上下文窗口减少。

Cost per success = 同臂所有计划任务实际已产生的总成本 / 该臂成功任务数，包含失败消耗。成功数0时null/undefined，不能除以1。Token代理量同理注明不是货币。不能对成功子集各取中位数再称每成功任务成本。

## 采纳与止损

`reject`：完整性/安全失败；`inconclusive`：基础覆盖/预算/凭据条件不足；`keep-native`：无清晰净值或质量回退；`canary-experimental`：小样本零关键回退且至少一项预注册效率（总逻辑input或整体耗时中位数下降10%）有一致信号；`adopt`不由这次小Gate自动产生。

这些10%初值只是个人决策规则，不是学术显著性门槛。两次固定小评测仍无效，就收敛到Ingress模式，不再追加系统层。大范围“更优”声明以后另冻结更大独立holdout和样本量分析。

## 日常命令

```bash
pnpm install --frozen-lockfile
pnpm check:fast                 # T01创建，无网络/无Provider
pnpm check:local                # 集中验收，无真实Provider
pnpm eval:small -- --preflight  # T08创建，不消费模型
PCR_LIVE=1 pnpm eval:small -- --config experiments/personal-canary.json
```

若部署机只有旧命令，按T01先创建统一入口，不将不存在命令标绿。新命令返回非零仅表示执行/证据错误；Gate结果拒绝本身是一份有效实验结果，不能写测试强制decision=adopt。
