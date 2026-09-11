# 离线审计脚本

所有脚本在本包范围内工作，不写目标项目源码，不调用Provider。源码诊断会执行目标仓库的模块，只应对你信任的本地源码使用。

```bash
python3 scripts/test_reference_metrics.py
python3 scripts/validate_bundle.py
python3 scripts/verify_source_zip.py /path/source.zip --expected-tree 728f66fabfafb41a3178761ee581cef8b3d153d3
node scripts/reproduce_source.mjs --repo /path/pi-context --out /tmp/source-probes.json
```

`reference_metrics.py`是统计语义的标准库参考，测试20项。它不是已经接入产品的修复；R07/R08需把这些行为落实到实际mjs运行器与报告。

`reproduce_source.mjs`读取实际TypeScript源码，用repo安装的或global TypeScript转译后执行，记录真实source digest/运行环境；不进行strict typecheck、不启动Pi。15个探针中13个是缺陷反例、2个是已修复正控制。基线反例复现成功不等于产品通过。目标修改后API可能变化，适配测试入口但不可改错误期望值以刷绿。

未知输出、时间超限、未执行探针都会有非零exit。Node低于项目engines时仍可诊断，但不能作为产品验收。本次独立诊断使用Node22.16/TS5.8.3，正式验收须使用项目锁定组合。

`source-probes.template.mjs`含两个由launcher替换的字面量标记，是模板插值，不是未实现的业务占位逻辑。不要直接运行该模板。
