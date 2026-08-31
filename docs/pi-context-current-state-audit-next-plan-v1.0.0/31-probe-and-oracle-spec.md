# Probe 与 Oracle 规范

## Source Witness

每个 expected item 必须有：

```json
{
  "id": "version-current",
  "kind": "temporal-value",
  "expected": "7",
  "normalizer": "version-string-v1",
  "sourceRefs": ["user-entry-17"],
  "polarity": "is",
  "validFrom": 17,
  "supersedes": ["version-old"]
}
```

Runner 在调用模型前验证 witness；不可满足 case 直接 fail infrastructure。

## Probe-only Scoring

- temporal：仅解析 Probe 最终答案，不看 summary；
- prohibition：必须显式否定目标动作；
- branch：必须拒绝 merge，不能只复述分支名；
- non-answer/tool-call text：失败；
- unsupported action claim：失败；
- summary/artifact 只用于 retention score。

## Environment Scoring

自然语言回答不是主结果。主结果来自 file hash、git diff、test exit、forbidden command/endpoint、database/mock state。
