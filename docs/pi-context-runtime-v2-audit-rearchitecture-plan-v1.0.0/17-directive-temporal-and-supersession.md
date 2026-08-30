# Directive、Temporal 与 Supersession

## Clause-first，而不是 marker-first

算法：

1. Unicode sentence/clause segmentation；
2. 识别 directive marker；
3. 扩展到完整 clause 边界；
4. 保存 exact quote 与三种 offset；
5. 尝试解析 key/value/polarity/scope；
6. 解析失败仍保留 exact clause；
7. later authenticated user clause 才能 supersede。

## Temporal Example

输入：`改为 version 7；以最新值为准`

输出：

```json
{
  "kind": "correction",
  "polarity": "must",
  "key": "version",
  "value": "7",
  "exactQuote": "改为 version 7",
  "status": "active"
}
```

不得生成 `version=7-tu-00`，除非 source evidence 真实包含该字符串。

## Oracle 同源规则

Benchmark expected fact 必须引用 witness span；derived expected 必须提供 deterministic derivation function 和输入 refs。
