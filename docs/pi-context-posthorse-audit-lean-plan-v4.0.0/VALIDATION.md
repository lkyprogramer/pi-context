# 验证记录与证据边界

本包验证的是规格文件、接口/任务映射、来源哈希和离线复算工具，不把这些检查当作pi-context产品验收。

## 当前执行的验证

- 附件ZIP按Git blob/tree算法与Unix文件mode重建tree，匹配当前GitHub `19a5b264ec57ae2ab69fb16f3433067354c1f6b1`。
- 最新实验source manifest的628项中627项同路径逐字节一致，0项不一致，1项归档脚本缺失；不能据此宣称整个旧运行目录可复现。
- `scripts/recompute_report.py`对全部300组数字/状态重新聚合：四臂完整289，主比较完整290；继承既有判分，不重写为“修正后的成功率”。
- `tests/test_recompute.py`的11项标准库单元测试通过：分母、缺失值、N/A恢复、重复ID、可选诊断失败、零基线和输入不变。
- `scripts/reproduce_current.cjs`执行7个原TypeScript函数隔离探针：3个评分边界、活动消息去重、指针可见结果、图片入口丢失、下一leaf证据读取。结果见`evidence/isolated-reproductions.json`。端口是测试替身，未运行完整Pi，也不是目标模型行为测试。
- 文档合同及12任务中20段TypeScript示例经过语法转译检查，无语法诊断；未宣称目标新接口已经实现或完成跨包类型检查。
- 仓库已有launcher Python测试3项通过，记录在`evidence/launcher-tests.log`。
- Markdown链接、JSON解析、12任务DAG、16Finding覆盖、32项旧计划对照、样例source witness哈希、请求预算和最终Manifest由`verify_bundle.py`检查。

## 未执行与不可推导

本容器Node为22.16.0，低于锁定宿主22.19.0；Corepack下载pnpm遇到DNS `EAI_AGAIN`，附件不含依赖，因此没有在本地重跑全部Vitest/严格编译/packed/真实Provider。环境失败原文见`evidence/pnpm-environment.log`。

当前项目strict/build/packed成功来自同HEAD GitHub Actions，unit仍1失败，兼容矩阵未全绿；不是本地重复执行。没有调用用户目标模型，没有发送凭据到外部服务，没有重扫用户未附带的原始数据库，没有安装Posthorse fork，没有推送或修改远端仓库。

本包sample场景是明确标记的synthetic示例，不是已经运行成功的12条真实holdout。目标Task中的新接口、命令和测试必须由后续AI实施，不能把本文或JSON模板当作产品代码完成证明。

## 复验

```bash
python3 scripts/verify_bundle.py
python3 -m unittest discover -s tests -v
python3 scripts/recompute_report.py --input evidence/pairs-metrics.json --output /tmp/pcr-recomputed.json
# TypeScript来自目标仓库已有依赖；不联网安装：
node scripts/reproduce_current.cjs /path/to/pi-context /tmp/pcr-source-repro.json
```

Manifest使用相对路径。工具执行可能产生`__pycache__`，它不属于交付内容，也不进入Manifest。最终下载ZIP经过完整性检测，并在新目录解压后再次执行相同结构/Manifest验证。
