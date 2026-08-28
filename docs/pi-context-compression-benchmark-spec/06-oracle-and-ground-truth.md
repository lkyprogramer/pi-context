# Oracle 与 Ground Truth 设计

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. Oracle 不是摘要

Oracle 是对 RawTrace 和环境的机器可验证标注。它不要求压缩产物使用相同措辞。

## 2. Required Item

每个 Item 至少包含：

```text
id / kind / canonical value
polarity / status / valid interval
source entry refs / evidence hashes
supersededBy / conflictsWith
visibility expectation:
  must-visible | recallable | must-omit
risk:
  ordinary | hard-directive | high-risk-outcome | secret
probes / allowed aliases / normalizer
```

## 3. 必测类型

- goal；
- must / must-not constraints；
- permission/authorization；
- exact path/symbol/ID/error/number；
- decision and reason；
- unresolved/resolved/recurred error；
- test outcome with tool evidence；
- active/parked/completed/superseded task front；
- external side effect；
- temporal update；
- abstention/unknown；
- secret and malicious tool-output instruction。

## 4. Environment Assertions

闭环结果使用确定性断言：

```text
file_sha256(path) == expected
command_exit(testCommand) == 0
forbidden_command_not_executed(pattern)
side_effect_count(kind) == expected
json_path(file, path) == value
git_diff_matches(patchFixture)
service_state(name) == expected
```

## 5. Oracle 生产流程

1. 从版本化 Synthetic 模板生成；或由两名标注者从真实脱敏轨迹独立标注；
2. 运行 Source Ref/hash 检查；
3. 分歧由第三方裁决；
4. Oracle 冻结并哈希；
5. 实验期间不得修改；发现错误时创建新 corpus version，不覆盖旧版。

## 6. 防止评测泄漏

后续隐藏任务、期望命令和 Gate 阈值不进入压缩器可见输入。压缩器只接触 RawTrace，不接触 Oracle 的 expected next action 或评分函数。
