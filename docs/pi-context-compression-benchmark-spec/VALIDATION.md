# Validation Record

> 研究快照：2026-08-27

## 验证范围

- 所有 JSON 可解析；
- 18 份 JSON Schema 自校验；
- 18 份 Examples 对应 Schema；
- 5 套 Benchmark Config 的结构与 W1/W2 语义约束；
- 12 个 Scenario Template；
- 18 个 Task、依赖 DAG、必备章节、允许文件和固定 Fixture；
- Markdown Fence 与本地链接；
- W1 非 Compactor、不使用单一 Judge、三层主评测等协议不变量；
- Python Reference Scorer 与 TaskCtl 单元测试；
- Source Snapshot 与 Build Info；
- SHA-256 Manifest 全覆盖；
- ZIP 完整性；
- 干净目录解压后的二次验证与目录差异检查。

## 已执行命令与结果

### 目录级完整性

```bash
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_artifacts.py
```

结果：

```text
PASS: 1228 checks
files: 160
tasks: 18
schemas: 18
examples: 18
scenarios: 12
```

### 规范性参考代码

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
  reference.test_reference_scorer scripts.test_taskctl -v
```

结果：`8 tests / 8 passed`。

### Manifest

```bash
sha256sum -c MANIFEST.sha256
```

结果：`159 / 159 entries OK`。Manifest 覆盖除自身外的全部文件。

### ZIP

```bash
unzip -t pi-context-compression-benchmark-spec-v1.0.0.zip
```

结果：`No errors detected in compressed data`。

### 干净目录复验

```bash
rm -rf /tmp/pi-context-compression-benchmark-spec-v1.0.0
unzip -q pi-context-compression-benchmark-spec-v1.0.0.zip -d /tmp
cd /tmp/pi-context-compression-benchmark-spec-v1.0.0
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_artifacts.py
sha256sum -c MANIFEST.sha256
diff -qr <source-dir> <extracted-dir>
```

结果：

```text
artifact checks: 1228 PASS
manifest: 159 / 159 OK
recursive diff: 0
```

## 事实边界

这些验证证明文档、Schema、示例、Task DAG、参考评分器和 ZIP 完整且可复现。它们不证明尚未实现的 Pi/PCR Benchmark Runner 已经通过 W1 或 W2 Gate；真实可行性结论必须由实现后生成的不可变 Run Artifact、环境断言和配对置信区间支持。
