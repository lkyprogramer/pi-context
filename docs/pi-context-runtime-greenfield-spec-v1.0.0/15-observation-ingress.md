# Observation Ingress 与 Tool Result Shaping

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

规定 Raw Capture、来源分类、尺寸门、reducer 调度、visible pointer 和 Pi result 返回。

## 2. 已冻结决策

- 原文先冷存，reducer 后生成模型可见视图。
- Tool-specific details 不被 PCR 覆盖或复用为内部 receipt。
- visible content 包含恢复指针、reducer revision、关键错误/状态。
- hard integrity failure 不允许 use-original 绕过。

## 3. Pipeline

```text
ToolResultEvent
→ normalize content blocks
→ size/secret/channel policy
→ raw bytes canonical encode
→ encrypted CAS
→ reducer registry dispatch
→ evidence projector
→ compact visible content
→ Pi ToolResultEventResult
```

## 4. Visible Pointer

```text
[pcr observation ev_...]
command: pnpm test
status: failed (exit 1)
failed tests: 2
primary error: packages/kernel/test/foo.spec.ts:42 ...
full result: ctx://observation/ob_...
```

该 pointer 不是本地文件路径。只有 PCR `context_read` tool 能在 scope、budget、secret policy 下展开。

## 5. Failure Policy

- CAS/integrity/source failure：strict/balanced fail closed；cost profile 可返回 bounded emergency excerpt，但必须标 `raw-capture-unavailable`；
- reducer unsupported：保留 bounded original + raw pointer；
- reducer exception：deterministic generic reducer；
- storage temporarily unavailable：阻断 side-effecting tool result continuation，避免把未留证据的 outcome 当已验证。

## 6. 不变量

1. ToolResultEvent content 在返回 Pi 前必须满足 provider size bounds。
2. 不得从 tool text 内容推断 authenticated-user。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `26-pi-tool-result-hook.md`
- `16-reducer-architecture.md`
