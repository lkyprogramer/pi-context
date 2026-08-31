# CI、打包与发布审计

## 当前 HEAD

- Commit：`9a2084d8667fc459aa14c3bd6c486228f15a6bf6`
- Actions Run：`33372538099`
- 结论：**失败**。

| Cell | 失败文件 | 失败测试 | 通过文件 | 通过测试 | Unhandled | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Ubuntu 22.19 current | 13 | 22 | 155 | 773 | 2 | fail |
| macOS 22.19 current | 13 | 21 | 155 | 774 | 2 | fail |

## 失败分类

1. **非移植路径**：多个测试固定开发机 `/var/folders/.../implementer`。
2. **非 hermetic provider 配置**：clean install 要求真实 `~/.pi/agent/models.json`。
3. **缺失 subprocess runner**：`node_modules/.bin/jiti` 未声明/不可用。
4. **时间与信号断言脆弱**：5 秒超时、强制断言 SIGKILL。
5. **流水线短路**：Unit 失败后 Acceptance、Pi Contract、Public-import Scan 被跳过。

## 发布状态

当前只能称为：

> 已有本地 staged tarball 构建脚本和部分 clean-install 证据，但当前 commit 的远端可复现发布验证失败。

不能称为：

- required CI 全绿；
- release candidate；
- public npm package；
- deterministic MVP 已满足最终验收。

## 元数据冲突

计划要求 `private:false` + SPDX license；当前 package 是 `private:true` + `UNLICENSED`，同时定义 internal tarball 分发。这可以作为内部试验策略，但必须在文档和 Gate 中统一，不能两套口径并存。
