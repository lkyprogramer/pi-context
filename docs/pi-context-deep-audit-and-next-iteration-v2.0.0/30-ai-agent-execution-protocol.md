# AI Agent 自动开发执行协议

## Controller

- 读取 `AI-START-HERE.md`、Finding、Task Index；
- 只分配依赖已完成的任务；
- 每个 Task 使用独立 worktree/branch；
- 允许并行的前提是 allowed files 无交集、无共享 migration/schema；
- 合并后统一跑 Full Gate；
- 失败证据不删除，状态标 blocked/reopened。

## Implementer

1. 重现 Finding；
2. 写 RED；
3. 最小实现；
4. Narrow tests；
5. Negative/fault tests；
6. Full Gate；
7. Evidence Seal；
8. Commit；
9. 不修改 Claim/Task 状态，由 Controller 验证后更新。

## Reviewer

只读复核：

- 实现是否绕开目标抽象；
- 测试是否 mock 掉被测行为；
- 是否出现 constant metric/string marker/preprogrammed executor；
- 是否扩大 scope；
- 是否能从 Raw Artifact 重算结果；
- 是否引入不安全 fallback。

## 并行建议

```text
W0: B01 || B02 || B05 || B06；B03→B04；B07可并行
W1: B08→(B09→B10)；B11；随后 B12/B13；B14；最后 B15
W2: B16→B18；B17；再 B19/B20
W3: B21/B22/B23；汇合 B24→B25/B26/B27→B28
W4: B29 || B30；汇合 B31
```

## 绝对规则

- 不允许为“让 Gate 绿”修改 locked corpus 同一版本；
- 不允许把真实失败改为 synthetic pass；
- 不允许使用用户 Home/凭证；
- 不允许在未验证时将 `publicationClaim` 改 true；
- 不允许开启 Semantic Beta，直到 B31 完成且有独立 Gate。
