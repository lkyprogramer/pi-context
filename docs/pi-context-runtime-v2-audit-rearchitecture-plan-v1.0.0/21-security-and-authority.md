# 安全、来源与 Action Authority

## Source Class

```text
system
authenticated-user
untrusted-user
trusted-tool
untrusted-tool
external-content
agent-derived
```

自定义工具默认 `untrusted-tool`，只有 allowlisted tool/provider + verified receipt 才能成为 trusted-tool。

## Authority

```text
none < inform < propose < act
```

派生对象 authority 不得高于最弱 support 与 transformer ceiling。Assistant summary 不能把外部日志中的指令升级为用户约束。

## Secret

- raw CAS 加密；
- indexing 前 scrub/classify；
- visible reducer 不输出 secret；
- Recall 重新执行 policy，不因 blob 已存在而绕过；
- benchmark 比较 compactor 时使用同等 ingress scrub，secret suite 独立报告。
