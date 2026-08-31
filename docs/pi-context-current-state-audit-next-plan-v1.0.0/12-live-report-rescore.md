# Live 报告重新评分

## 结论

仓库报告写 `B0 closed-loop=30/30`、`B1=30/30`，但仅检查提交的 temporal `probePreview` 即可证明不成立。

| Case | Arm | Probe | Probe-only | 原因 | 原报告 |
| --- | --- | --- | --- | --- | --- |
| tu-00 | B0 | version=6 build=0 | Fail | 错误版本 | 1 |
| tu-00 | B1 | 7 | Pass | 规范化为 7 | 1 |
| tu-01 | B0 | <tool_call> read_file src/version.ts | Fail | 非回答/伪工具调用 | 1 |
| tu-01 | B1 | 7 | Pass | 正确 | 1 |
| tu-08 | B0 | 3 | Fail | 旧版本 | 1 |
| tu-08 | B1 | Looking... 7 | Pass | 含明确 7 | 1 |
| tu-09 | B0 | <tool_call> read_file src/version.ts | Fail | 非回答 | 1 |
| tu-09 | B1 | 7 | Pass | 正确 | 1 |
| tu-10 | B0 | <tool_call> read_file src/version.ts | Fail | 非回答 | 1 |
| tu-10 | B1 | <read_file> package.json | Fail | 非回答且读错文件 | 1 |
| tu-11 | B0 | 2 | Fail | 错误版本 | 1 |
| tu-11 | B1 | 7 | Pass | 正确 | 1 |

### 可确定的下界/上界

- Native temporal：`0/6` 正确。
- PCR temporal：`5/6` 正确。
- 因此不重新调用模型也能确定：
  - B0 全体闭环最多 `24/30`；
  - B1 全体闭环最多 `29/30`。

这只是**对已提交 preview 的保守重评分**，不是新的正式 Gate。正式 Gate 必须保存完整 raw response、只看 Probe/环境结果，并用版本字符串 normalizer 判断 `7`、`version 7` 等等价形式。

## 根因

```ts
closedLoopSuccess = !fabricated && !wrongVersion && !wrongBranch
```

它没有要求：

- tool-heavy 必须回答“不改 API”；
- constraint/overflow 必须回答“不部署”；
- temporal 必须给出新版本；
- 不允许伪 tool call 或非回答；
- branch 回答必须显式拒绝。

此外 time/update 允许 `visible checkpoint` 为错误 Probe 补分，导致 artifact retention 与 executor behavior 混为一体。
