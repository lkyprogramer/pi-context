# 版本、证据等级与独立验证范围

## 核验身份

| 对象 | 固定值 |
|---|---|
| 附件 | e35e85f1-f855-465a-a176-8587511da731.zip |
| 附件SHA256 | d68edeefc9d8bd3c8a0bdce3f26e02631598261d9d29a4ca272abd95b7ce4bd0 |
| 附件文件数 | 9660（ZIP目录条目不计） |
| 分支 | v5/native-first |
| HEAD | 79c1ead5a611e077df5712ba50aaa7012f424cc5 |
| Git tree | b67277c0d3e0a3295f718010ea09b94fedb71437 |
| 另一个main，不纳入本分支结论 | e14804daf9aa31b342ddca718d789fa6860c2244 |
| 研究用Pi最新main | b2602be77cb7b0de45dd616407fd210daa48aa75 |
| Pi源码package版本 | 0.85.1 |
| 当前提交关联Actions GET结果 | total_count=0 |

Git tree按ZIP原始路径、文件可执行位和blob bytes重建，包含全部文件，不是只比较package.json。复现脚本与结果见evidence。分支没有关联云端run，不代表失败；不将旧main CI成绩套用，也不要求个人项目必须开复杂云矩阵。[S01,S02]

## 本次实际做过

1. 安全解压到独立工作目录；计算附件SHA256/Git tree并对照远端。
2. 通读当前src和eval关键路径、26项规格任务、打包/宿主测试及最新数字报告；按路径+行号登记问题。
3. 使用实际TypeScript源模块转译后在Node22.16.0执行15个隔离探针。使用受控事件和临时目录，不冒充真正Pi或Provider；其中图片探针仅证明错误hash未被拒绝，不表示图片解码成功。
4. 独立复算8组pairs和tarball hash；未重新请求目标Qwen。
5. 以本机TS5.8.3、替代Node类型22.19.7跑src严格tsc：exit0。这只证明该组合的静态检查，不是锁定TS5.9.2/Pi0.85.1/Node>=22.19的完整验证。
6. Exa检索发现机制后，用GitHub一手源码核验Pi、context-fold、context-manager、smart-compact关键模块；其余项目明确降为维护者README证据。

## 没有做过

没有本地安装锁定pnpm依赖（容器网络DNS不可用）；没有全量Vitest/Pi stock runtime重跑；没有Qwen服务权限与新live调用；没有在当前环境安装Posthorse fork；没有重建用户的真实开发长轨迹。库内测试日志和报告均标为作者提交证据，不当作本次独立运行结果。

## 提交增量的读法

`e0f4701f`真正移除了旧工作区；`463f685e/5ea7b763`完善Java/分支/容器；`01d52bf5`补C2/staging；`1eeef2d5`修工具配置同时改了题目；`79c1ead5`重试与8×2收口。后两次变更改变实验输入和重试规则，只能单独标识run，不能把5/8、2/8、7/8拼接成性能趋势。详见[commit-delta.csv](../evidence/commit-delta.csv)。

## 来源不足时怎么处理

n/a、unknown、无回读机会、无原生compact事件、无projection应用，分别记录。它们都不是pass，也不是可悄悄记成实现fail的同一个值。检索ref的哈希是完整性信息，不是访问授权。成功暴露表示某请求带了原文且成功返回，不表示模型理解了原文。
