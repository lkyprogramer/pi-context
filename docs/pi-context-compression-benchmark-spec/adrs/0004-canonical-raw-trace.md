# ADR 0004 — 所有实验从 RawTrace 重放

状态：Accepted  
日期：2026-08-27

## 决策

写入时 Reducer 会改变 Pi Session，不能从某个 Arm 的派生 Session 构造其他 Arm。

## 后果

所有实现、Schema、Task 和 Gate 必须遵守该决策；变更需要新 ADR，旧记录保留。
