# Validation Record

## 1. 验证边界

本记录验证的是 **文档包与 AI Agent 执行规格本身**：文件完整性、Task DAG、公共合同、Schema/Example、配置跨字段语义、Markdown 链接、Manifest、ZIP 以及全新目录解压后的可重复执行。

它不证明尚未实现的 `pi-context-runtime` 产品已经达到性能、质量、安全或兼容性目标。性能 SLO、长期任务成功率、Prompt Cache 收益和 Pi 版本兼容矩阵必须在实现阶段按 T41–T46 生成新证据。

## 2. 冻结基线

```text
Spec version: 1.0.0
Product version: 0.1.0-alpha.1
Pi repository: earendil-works/pi
Pi commit: 938109e7259068ff736dbba3bed14c81af25abbe
Pi coding-agent package: 0.84.3
Tasks: 48
Waves: 6
```

## 3. 环境准备

```bash
python3 -m pip install -r scripts/requirements.txt
```

验证脚本只使用文档包内相对路径，不依赖构建机目录、聊天上下文或包外 Agent Skill。

## 4. 冻结内容验证

依次执行：

```bash
python3 scripts/generate_indexes.py
python3 scripts/validate_task_graph.py
python3 scripts/validate_contract_consistency.py
python3 scripts/validate_artifacts.py
sha256sum -c MANIFEST.sha256
```

最终冻结运行满足：

```text
PASS: task graph consistency (1303 checks, 48 tasks, 6 waves)
PASS: contract consistency (857 checks)
PASS: artifact validation (4162 checks, 270 files)
Manifest: 269 / 269 entries OK
Zero-byte files: 0
Task graph cycles: 0
Orphan task documents: 0
Broken relative Markdown links: 0
Schema/example validation failures: 0
```

## 5. Task 自主执行协议验证范围

`validate_task_graph.py` 对全部 48 个 Task 检查：

- ID、Wave、依赖和拓扑顺序；
- Task 文件与机器可读 `task-graph.json`、`TASK-INDEX.json` 的一致性；
- 八步 TDD 流程；
- 精确 Create/Modify/Test/Evidence 写入集合；
- RED、GREEN、Full Gate 和 Evidence 路径；
- `sourceDigest`、Git Note 与本地 `.pcr` 状态协议；
- 禁止包外 Skill、占位符和越界实现；
- 可并行任务只在依赖完成且写集合不相交时返回。

## 6. Contract 一致性验证范围

`validate_contract_consistency.py` 检查：

- Pi 基线版本与 Commit 锁；
- `SourceClass`、`ActionAuthority`、Cache Zone、Materialized Section 枚举；
- TypeScript 参考合同与 JSON Schema 一致；
- 单一 Pi Extension Entry；
- Pi 公共包 Peer Dependency 策略；
- DSH 遗留术语和旧接口名未进入可执行规格。

## 7. ZIP 与全新目录验证

打包后执行：

```bash
unzip -t pi-context-runtime-greenfield-spec-v1.0.0.zip
unzip pi-context-runtime-greenfield-spec-v1.0.0.zip -d clean-extract
cd clean-extract/pi-context-runtime-greenfield-spec-v1.0.0
python3 scripts/validate_task_graph.py
python3 scripts/validate_contract_consistency.py
python3 scripts/validate_artifacts.py
sha256sum -c MANIFEST.sha256
```

最终 ZIP 要求：

```text
Compressed data errors: 0
Source/extracted recursive diff: 0
Source/extracted file-count difference: 0
Extracted Manifest mismatches: 0
```

## 8. 不能由本验证替代的实现证据

以下结果必须由未来实现仓库产生，不得引用本 ZIP 的验证结论冒充：

- Pi Hook 的实际运行时顺序与 Fail-open 行为；
- 原始 Tool Result 在 Pi 持久化前被捕获；
- SQLite/CAS Saga 的真实崩溃恢复；
- 长会话 `structuredClone` 成本和周期性 Host Compaction 收敛；
- Directive、Claim、Continuity、Recall 的行为质量；
- Memory Poisoning、Secret、Authority 和 Action Gate 的攻击语料结果；
- Prompt Cache eligible-prefix reuse、Provider cache token 与每成功任务成本；
- Packed `pi install`、升级、回滚和多版本 CI。
