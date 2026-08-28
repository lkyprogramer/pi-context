# Benchmark Corpus 构建计划

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 四层语料

1. Synthetic exact：每次 CI 运行；
2. Template coding：生成小仓库、工具日志和可验证变更；
3. Real redacted：真实长轨迹，双人 Oracle；
4. External adapters：LongMemEval/ToolHaystack/MemGym/TRACE-style scenarios。

## 每个 Scenario 必须交付

```text
scenario.json
raw-trace.json
workspace.tar.zst + sha256
oracle.json
probe-suite.json
hidden-task.sealed
assertions.json
source-license.json
```

## 版本规则

任何内容变化都生成新 `corpusVersion`；旧 version 不删除。Gate 运行只引用版本和 hash，不引用“latest”。
