# 审计范围、证据与方法

## 审计基线

- 附件源码：`9907f69c-1ace-47b4-ad03-84b37cc77eb3.zip`
- SHA-256：`ac3fd46a8dbdd03ac31e16e7184d263f572680b6a7c27b0cdf8e5d55a4b36155`
- 与 GitHub 当前 HEAD 一致：`6c5c5b5ace3c14ea28535de9de2b95cc4fa40a31`
- 对比基线：上一版审计 HEAD `9a2084d8667fc459aa14c3bd6c486228f15a6bf6`
- 重点提交：W0–W5、directive backfill、triplicate live、三条 long-horizon live、最终报告。

## 实际执行

本环境执行了不需要第三方依赖的静态校验：

```bash
node scripts/check-package-boundaries.mjs
node scripts/ci/format-lint.mjs
node scripts/ci/oracle-validation.mjs
node scripts/ci/verify-protection.mjs
python3 scripts/findingctl.py list
python3 scripts/validate_task_graph.py
```

并直接下载当前 Compatibility Workflow Artifact，分析原始 Unit Log。完整测试没有在本地重复运行：附件不含 `node_modules`，工作容器未安装 `pnpm`，因此执行证据以 GitHub Actions 当前 HEAD 日志为准。

## 证据等级

| 等级 | 含义 | 示例 |
|---|---|---|
| E1 | 当前源码直接可见 | RuntimeSession bypass、staged 内存、constant toolPair |
| E2 | 当前 GitHub CI 原始日志 | Node 24 Compatibility W1 Gate failure |
| E3 | 当前仓库原始 JSON/Markdown 报告 | threshold=false、overflowObserved=false、threeCompacts=false |
| E4 | 组件测试/合成结果 | V3 string arms、in-process continuation |
| E5 | 推断 | 多 Session 交错时 global cursor 的风险；明确标为架构推断 |

## 判断原则

- 文件存在不等于功能完成；
- 组件测试通过不等于默认产品路径使用该组件；
- Raw Data 保留不等于模型当前可见、可检索或行为等价；
- “Live”必须真实启动 Pi、加载当前扩展并调用真实 Provider；
- “Closed-loop”必须由模型自行选择工具，最终由 Workspace/DB/Side-effect 状态评分；
- 发布结论只能来自同一 HEAD、同一不可变 Run Bundle、同一规范 Scorer。
