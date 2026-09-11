# 来源、快照和证据等级

附件 `d68c9a53-f167-461f-a046-cff4c6a1e439.zip`：16,134,361 bytes；SHA-256 `ec4c74a4cc6541912485e5a0408fbd24afa6573b8da4eece838a2eae3482d59e`。本次逐文件读取ZIP，保留可执行位与符号链接类型，重建9,868个文件的Git tree，等于远端main的 `728f66fabfafb41a3178761ee581cef8b3d153d3`。

main `7478307ead72e849e9c619a913858afe8a06d38b`；v5/native-first 为 `6f59ba9ef11fd48387b44ac5dfc702732cf652a3`。本轮以用户新附件与main为准，不使用旧分支成绩代替。上一版规范以本会话原始 `pi-context-native-first-review-v6.zip` 为准；仓库内同名docs已被再次编辑，不能把被修改的验收标准当作旧要求本来如此。

## 本轮实际完成

- 读取当前src、test、eval/local、配置、README、HANDOFF、迭代记录及旧N01–N12。
- 根据实际源模块转译，执行15项隔离诊断：13个剩余缺陷反例、2个旧问题修复正控制。转译环境Node22.16.0 / TypeScript5.8.3；未替换产品逻辑；没有完整Pi和Provider参与。
- 阅读远端当前HEAD的required/compatibility状态；required的unit失败日志明确为 `Command "test:unit" not found`。typecheck和packed-install-hermetic通过，不能重复断言当前源码编译不通过。
- 重新核验官方Pi上下文与OpenAI-compatible usage映射。该研究固定参考源码b2602be；不等同于证明本机npm包每个文件与该commit一致，R07须对安装包核对。

## 未完成与不能声称

当前环境没有pnpm/docker，npm registry DNS不可用；没有在要求的Node≥22.19.0/TS5.9.2上执行完整Vitest，没有重跑目标Qwen服务。附件和tracked tree没有 `artifacts/local-eval/20260909-112407` 原始attempt/request/fold/result文件。本包只摘录项目已经披露的数字，不把旧300对或别的run拼接进来。

最新commit主要是报告/包装文案；迭代日志同时标记实际run HEAD `19080243`、dirty=true，声称仅多余image.json，入口hash未变。缺完整run/code/config/tarball manifest，无法独立确认“该实验就是当前完整产品”。仅入口JS hash不能覆盖所有被导入模块。

## 证据分级

E1：本次执行实际函数得到的输出（source-probes）。E2：固定HEAD源码与CI直接记录。E3：仓库自报运行结论（reported-trial-claims）。E4：本报告设计推断/建议。每项Finding标注等级；不得用E3填补E1/E2未覆盖的能力。
