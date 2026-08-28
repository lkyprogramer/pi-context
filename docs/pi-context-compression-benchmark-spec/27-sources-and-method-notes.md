# 来源与方法说明

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## Pi 一手资料

- Pi repository: `https://github.com/earendil-works/pi`
- Extension API/types and runner: `packages/coding-agent/src/core/extensions/`
- Agent loop transformContext: `packages/agent/src/agent-loop.ts`
- Compaction docs: `packages/coding-agent/docs/compaction.md`
- Session format: `packages/coding-agent/docs/session-format.md`

## 评测方法一手资料

- TRACE / paired closed-loop continuation: `https://arxiv.org/abs/2608.06503`
- LongMemEval: `https://arxiv.org/abs/2410.10813`
- ToolHaystack: `https://arxiv.org/abs/2505.23662`
- MemGym memory-isolated evaluation: `https://arxiv.org/abs/2605.20833`
- Context Compaction Theory: `https://arxiv.org/abs/2608.01326`
- ACON paired full-success/compressed-failure optimization: `https://arxiv.org/abs/2510.00615`

## 使用原则

本规格主要吸收问题定义和评测方法，不把论文或社区项目的自报收益直接当作 PCR 预期结果。
