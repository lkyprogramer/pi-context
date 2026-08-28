# Release Captain Playbook

只在 T45、T46、T47 全部完成并有 fresh evidence 后执行 T48。Release Captain 在干净目录验证 source archive、npm tarball、SBOM、manifest、Pi compatibility、security/fault/performance/benchmark Gates；任何 Critical/High 失败不可 waiver，也不得通过修改测试或降低阈值掩盖失败。

## Required sequence

1. 校验 `.pcr/task-status.jsonl` 中 T01–T47 均为 `done`，并核对依赖提交 SHA。
2. 在干净 clone 执行 `pnpm install --frozen-lockfile`、`pnpm check:all` 和 packed install smoke。
3. 执行 T45/T46 Gate 复核；Semantic Beta 未启用时，T46 必须明确记录 `not-enabled-by-release-profile`，不得伪装为通过。
4. 运行 SBOM、license、secret scan、manifest 和 reproducible archive 比对。
5. 按 T48 生成最终 evidence bundle，并记录每个结论对应的命令、退出码和输出路径。
6. 任何失败都保留原始日志，停止发布；不得在 Release Captain 阶段实现新功能。
