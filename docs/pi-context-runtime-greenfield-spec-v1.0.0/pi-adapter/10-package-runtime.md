# Package Runtime

最终 npm 包只有一个 extension entry。Pi packages 使用生产安装，运行依赖必须在 dependencies。Pi core peer 使用 `*`，实际版本由 compat lock 和 startup probe 限制。
