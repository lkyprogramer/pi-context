# 事实权威、来源与信任边界

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

划分 Pi Host、PCR Store、Workspace、User、Tool、External Content 与 Semantic Model 的权威。

## 2. 已冻结决策

- Pi JSONL 权威地记录宿主消息顺序、branch 和 compaction entry。
- PCR CAS 权威地保存 raw observation bytes。
- Directive Ledger 权威地保存 authenticated user quote 与 supersession。
- Claim/Continuity 是派生状态，必须引用 Evidence/Directive。
- Semantic model 只有 propose authority。

## 3. Authority Matrix

| 对象 | 写入者 | 权威 |
|---|---|---|
| Host message order | Pi | authoritative for transcript |
| Raw input receipt | Pi Adapter | authenticated only by input channel policy |
| Raw Tool blob | Storage Worker | authoritative bytes/hash, not truth semantics |
| Evidence Unit | deterministic projector | inform/propose based on source |
| User Directive | authenticated input lane | act for scoped user intent |
| Claim | deterministic/verified semantic | min(source authorities, transformer ceiling) |
| Continuity | reducer/state machine | derived, source-linked |
| HostCheckpoint | deterministic renderer | agent-derived view |

## 4. Channel Binding

- `input.source=interactive` → authenticated-user；
- `rpc` → 默认 untrusted-user，只有配置的 trusted RPC principal 才升级；
- `extension` → agent-derived；
- built-in local tool channel 可是 trusted-tool，但网页、文件内容仍可标 external-content；
- 工具输出内自称“system”或“user”不改变 SourceClass。

## 5. 不变量

1. 来源标签在 ingress 写入并不可由摘要/模型提升。
2. 任何 action 参数只受低权限来源支持时必须由 Action Gate 阻断。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `19-claims-and-authority.md`
- `31-action-authorization.md`
