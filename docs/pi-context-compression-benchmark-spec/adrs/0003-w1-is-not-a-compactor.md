# ADR 0003 — W1 不作为独立压缩器比较

状态：Accepted  
日期：2026-08-27

## 决策

W1 Gate 使用 Pi Native + W1 的增量臂；Compactor head-to-head 推迟到 W2。

## 后果

所有实现、Schema、Task 和 Gate 必须遵守该决策；变更需要新 ADR，旧记录保留。
