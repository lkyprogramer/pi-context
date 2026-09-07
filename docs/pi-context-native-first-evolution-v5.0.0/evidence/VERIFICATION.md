# 本次实际执行的验证与未执行范围

## 实際已执行

**源码基线校验**：复算原始附件SHA256及全部9,766个文件组成的Git tree，与已读取的GitHub head tree一致。`attachment-recheck.json`是独立脚本再验结果；脚本只核对已记录基线，不重新联网查询最新head。

**8项源码组件探针**：直接转译并执行当前源模块。Pi导出与上下文只使用最小stub，未改变被测逻辑。完整结果、模块SHA及作用范围见`audit-probes-result.json`。不是Pi真实loader或完整产品测试，不能与仓库保留canary混为一谈。

**统计工具**：先观察RED，再实现并通过11个测试，覆盖缺失分母、cluster重复、未知价格、混合演示/真实数据、无样本和单侧不利事件上界。日志为`eval-tools-red.log`与`eval-tools-green.log`。

**文档检查工具与SQLite样本**：7个测试覆盖schema拒绝、DAG循环／缺依赖和实际SQLite FTS插入／更新／级联删除。日志为`bundle-tools-red.log`与`bundle-tools-green.log`。这是设计工具／DDL验证，不是未来Node Worker集成。

**3组Java oracle校准**：J01/J02/J07初始缺陷源码均可编译且被oracle拒绝，已知正确参考均通过。见`java-oracle-calibration.json`。不包含真实Pi、真实模型、Maven或Spring集成执行。

**TypeScript规范与文档包**：`contracts/model.ts`使用本机TypeScript做strict/noEmit检查；本地链接、JSON、任务DAG、需求映射及ZIP完整性由最终检查记录。类型规范不引用Pi，不证明真实宿主类型兼容。

## 没有执行

未安装／运行目标官方Pi0.85.1、未执行现有仓库全部vitest、未进行新插件实现、未做真实C2模型回读、未做E2E编码或第三方论文复跑。容器依赖安装遇DNS错误，日志在`dependency-attempt.log`。新版本需Node>=22.19，本机探针环境Node22.16也不能作为目标宿主环境背书。

`current-canary-report.json`是**仓库已有报告的副本**，不是此次新实验。其inconclusive、isolation-unproven、C2未成功和费用未知均原样保留。

## 复跑本次组件探针

需Node与可解析的TypeScript包（支持项目内或全局安装）。对原附件v4源码执行：

```bash
node scripts/audit-current-source.cjs /absolute/path/to/pi-context-v4 audit-result.json
python3 scripts/verify_attachment.py /absolute/path/to/original-upload.zip
```

该源码探针用于复现旧基线边界，不作为v5验收器；v5删除旧路径后它预期不能直接运行。v5回归由任务卡转写到新模块与真实宿主测试。

## 检查设计包自身

```bash
bash scripts/run_design_checks.sh --with-java
```

可将stdout重定向到日志，也可通过nohup启动。这只检查本包内容和辅助脚本，结尾明确声明不验证产品。依赖不满足时失败／not-run，而不是伪造通过。
