# ADR 0001 — 采用三层主评测

状态：Accepted  
日期：2026-08-27

## 决策

Static、Reader-isolated、Paired Closed-loop 分别回答结构、可读和行为问题；任何一层不能替代另两层。

## 后果

所有实现、Schema、Task 和 Gate 必须遵守该决策；变更需要新 ADR，旧记录保留。
