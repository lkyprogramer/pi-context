# 集成到 `pi-context-runtime-greenfield-spec-v1.0.0`

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


本目录不修改旧 ZIP；它给出新版本应采用的替换关系。

1. 原 `38-benchmark-evaluation.md` 标记 superseded，改为引用本包 03–17；
2. 原 W1 Gate 修改为 A0/A1/A2，不再称 W1 为独立 Compactor；
3. 原 T42 改为接入 B12/B15/B16，而不是重新发明评测；
4. 原 T45 只消费 B17 的 `gate-decision.json`；
5. PCR W0 增加 B01–B05，确保实现前就有 baseline harness；
6. PCR W1 完成后执行本包 W1 Gate，结果决定 W2 是否继续。
