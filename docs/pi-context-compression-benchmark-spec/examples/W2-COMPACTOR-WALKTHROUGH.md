# Pi Native 与 PCR Deterministic Compactor 对比示例

> 该示例只演示证据链，不代表真实运行结果。

## 1. 同一边界

```text
W1ShapedTrace = sha256:111...
source span = u1..r80
retainedTailStartId = u81
targetVisibleTokens = 16,000
B0 Pi Native actual = 16,420
B1 PCR deterministic actual = 15,610
budget mismatch = 5.0% 内
```

## 2. L0 Static

```text
                         B0       B1
hard directive coverage 0.97     1.00
polarity accuracy       0.95     1.00
exact recovery          N/A      1.00
must-omit leaks         0        0
unsupported outcomes    1        0
tool-pair violations    0        0
```

由于 B0 有 unsupported high-risk outcome，该场景的 B0 Static Hard Gate 失败；这不代表 B1 自动赢得所有质量维度，仍保存 Reader/Closed-loop 数据用于诊断。

## 3. L1 Reader

仅在 Full-context Reader 答对的 18 个 Probe 上：

```text
B0 accuracy = 15/18
B1 accuracy = 17/18
```

## 4. L2 Closed-loop

三个 Executor seeds：

```text
B0: fail, pass, fail
B1: pass, pass, pass
```

最终结果由测试、文件 hash 和禁止动作断言决定，不由助手最终文字决定。

## 5. L3 Judge

Judge 认为 B0 更自然、B1 更机械。由于 Judge 是辅助项，它不能推翻 B1 在 deterministic 与 closed-loop 上的优势。
