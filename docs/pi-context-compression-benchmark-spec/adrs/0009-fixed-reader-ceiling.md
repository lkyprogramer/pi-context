# ADR 0009 — 固定 Reader 与 Full-context Ceiling

状态：Accepted  
日期：2026-08-27

## 决策

只对 Full-context Reader 能回答的 Probe 计算 compressor loss。

## 后果

所有实现、Schema、Task 和 Gate 必须遵守该决策；变更需要新 ADR，旧记录保留。
