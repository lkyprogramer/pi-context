# Foundation 与可复现输入实施计划

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 目标

完成 B01–B05，使任何 AI Agent 都能从同一 RawTrace 和 BoundarySnapshot 重建 Pi Native 基线，并生成哈希稳定的 Artifact。

## 顺序

1. B01 冻结 TypeScript Contracts 与 JSON Schema 映射；
2. B02 在任何 Reducer 前捕获 RawTrace，并实现无 Provider 的确定性 replay；
3. B03 冻结 Pi Home、Session JSONL Tree、Workspace 和 Runtime Store；
4. B04 建 Oracle/Probe/Environment Assertions；
5. B05 用公开 Pi API 运行 Native Arm。

## Foundation Gate

- 同一 RawTrace 连续捕获两次，canonical hash 相同；
- Snapshot restore 后目录、文件 SHA、Session Leaf 和 Branch 一致；
- Oracle 的所有 source refs 可解析；
- Pi Native 在相同 seed 下产生可解释的非确定性记录；
- Run Manifest 能重算所有输入/输出 hash；
- 不导入 Pi 私有 `src/` 路径。
