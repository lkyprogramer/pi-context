# 最新G4/C2报告：可以说明什么，不能说明什么

数据文件固定为当前分支 `artifacts/v5-evaluation/{pairs,report}.json`。复算输入在本包`evidence/pairs-numeric.json`，没有混入老PCR的300组实验。

## 1. 实验量与实际候选

“8×2”是8个任务×B0/B2两臂，共16次主arm；所有`repetition=0`。不是8个任务各重复两次，也不是16个独立任务。latest有空响应重试，额外attempt未完整保留到pairs中。

G4候选只设置plugin=true并安装包；`src/extension.ts`硬编码DEFAULT_CONFIG=observe，g4-agent没有执行profile切换。因此报告B2实际接近原规格B1（原生compact+history工具），不能当作balanced。即使后续修好config loader，也必须在每次run记录实际profile和projectionApplied，不能靠“装了插件”推定功能生效。

## 2. 原报告数字（不是新的模型成绩）

| Case | B0通过 | 标为B2的候选通过 | B0记录token | 候选记录token | B0 wall ms | 候选 wall ms |
|---|---|---|---:|---:|---:|---:|
| J01 | 是 | 是 | 8805 | 9821 | 16217 | 17009 |
| J02 | 是 | 是 | 8225 | 8640 | 9570 | 9311 |
| J03 | 是 | 是 | 6652 | 7129 | 14156 | 14531 |
| J04 | 是 | 是 | 11692 | 9943 | 9516 | 8363 |
| J05 | 否 | 是 | 1361 | 92588 | 5359 | 53172 |
| J06 | 是 | 是 | 5115 | 5658 | 8182 | 7630 |
| J07 | 是 | 是 | 12068 | 9419 | 18077 | 14446 |
| J08 | 是 | 是 | 12304 | 5699 | 15213 | 7851 |

`billedTokens`代码是Σusage.totalTokens（fallback input+output），可能包括输出和种子假usage，不是账单输入。首次失败attempt可能被覆盖；`monetaryCost`全部null。只能叫**报告记录的token代理量**。本包复算分别列all8与excludeJ05两组，不把不同统计量混成“节省百分比”。

普通7题双方全过；J05是预期B0不能用pctx_history的能力挑战。J05增加的92,588 token是恢复工作量信号，并不能用来证明压缩低成本；也不能据此断言history永远不值得，因为B0并未完成同等任务。

## 3. 场景适切性

- J03最终prompt已经写出Spring自调用问题和应把@Transactional放transfer的方法，测编码执行，弱化了历史理解需求。
- J04直接说a-b改a+b；日志是否被保留/回读不再是解决题目的必要条件。
- J06当前要求与文件已经给出app，分支测试有一定价值但不能仅靠最终答案证明兄弟分支没有进入检索。
- J08初始session无足够历史，compact异常被记录后继续；不要求`compacted=true`，可在未发生compact时通过。
- J05两边都被指示调用pctx_history，而B0没有此工具。适合单臂API功能验证，不是公平压缩对照。

因此保留这些fixtures作为普通功能回归；另增真正需要历史的任务，不必删除或篡改历史报告。

## 4. C2证据边界

随机nonce是进步，但当前nonce按arm生成，retry再生成；并通过`G4_SEED_NONCE`传入agent容器环境。当前J05限制了部分工具，不能由此断言模型已利用环境泄漏；但它违反了“事实只在原生历史”的隔离证明。`historyCalled`只证明出现过调用，未绑定返回页hash/引用与最后使用结果。

正确C2由可信控制器生成一次nonce并形成受控原生tool result；期待值仅存grader侧。不得出现在agent环境、最新prompt、普通项目文件或报告可读附件。先记录全文一次成功暴露，再自然追加旧历史并压缩，模型中立地完成后续任务。精确回读结果必须匹配来源块hash；不能把原生意外成功强行改判失败。若刻意禁止baseline访问历史，将此试验单独标“history功能负对照”，不纳入质量晋级。

## 5. 评分与成本缺陷

`closedLoopCases=bothPass+C2特殊成功`把异质问题相加，得到8；不表示8个公平quality case通过。`criticalViolation=null`经Boolean转false，把未测当作没有违规。`resourceNetEvidence`仅选双方成功样本，再比两列中位数；失败、重试成本未完整计入。声明不做2%NI是对的，但“limited-trial”也须先确认当前功能与模式。

重试不得`result=retry`覆盖第一份；每attempt有独立记录，共享同一场景输入，计入全局预算和全任务usage。unknown tokens不能按0推断empty turn。报告必须区分执行status、oracle outcome、证据complete与安全check result。

## 6. 更严重的测试安全缺口

Agent端Docker与broker是有价值的隔离。但是Java、Maven判题在**宿主**运行agent生成的代码，继承宿主环境；候选可改POM或在Java静态初始化中执行任意动作。移动到临时cwd不构成安全边界。Maven只要打印pass token就通过，甚至不要求exit0。[S05]

先完成E02（容器判题）再运行任何新模型编码实验。源码审计证明风险路径存在，本次没有执行恶意候选来利用它。
