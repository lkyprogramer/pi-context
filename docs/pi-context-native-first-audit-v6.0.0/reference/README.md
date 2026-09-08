# 可运行参考资产的边界

`probe-cases.mjs`是对79c1ead5的历史审计探针，运行真实源码，不是复制缺陷函数来证明自己。`scripts/run_source_probes.mjs`只转译用户指定目录到临时目录，不改项目，不联网；需要该项目安装TypeScript。它不替代strict tsc，不启动Pi，不调用Provider。修复接口后应把各反例纳入A01–E04的正式测试，旧探针可能不适配新签名，不得为维持旧探针而保留错误API。

```bash
node scripts/run_source_probes.mjs /path/to/pi-context /tmp/pctx-source-probes-new.json
```

本次执行环境低于项目min Node，结果只作隔离源码证据。正式验收用项目支持版本。

`utf8_reference.py`和`test_*.py`是标准库参考测试，证明字节分页和离线统计公式的期望，不是修复后的TypeScript插件。`scripts/recompute.py`针对附件8对已提交结果，输出明确保留原评分和不完整attempt覆盖，不能用于宣称新产品通过。
