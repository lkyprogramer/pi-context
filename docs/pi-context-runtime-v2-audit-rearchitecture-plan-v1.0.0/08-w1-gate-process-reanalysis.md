# W1 Early Net Value Gate 复盘

W1 的方向——先证明 ingress reducer、exact recovery、proactive recall——是正确的。但当前证据不能作为独立 Gate：

- 语料是实现者拥有的合成开发集；
- 第一次 realized net 为 0 后，通过加入大量 filler 扩大 raw output，随后同一 Gate 变为通过；
- 这证明 reducer 能压缩人为加入的冗余，不证明真实 workload 的净收益；
- 完整 W1 功能没有进入产品 Composition Root。

## v2 规则

- `corpus/train`：允许开发者调 reducer；
- `corpus/dev`：允许选择配置；
- `corpus/locked-test`：hash 冻结，开发者不可查看 hidden continuation oracle；
- 任何 corpus 变化都生成新 benchmark major；
- W1 Gate 必须通过真实 Pi tool_result Hook，不允许直接调用 reducer 函数替代产品路径；
- exact recovery 必须从加密 CAS 实读；
- token benefit 要在真实 tool distribution 加权，而非简单平均。
