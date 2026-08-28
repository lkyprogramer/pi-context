# AI Agent 自主执行协议

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 一次只执行一个 Bxx Task

Agent 必须读取 Task、依赖 Evidence、涉及 Schema 和对应主规格。不得跨 Task 顺手修改公共接口。

## 2. 每个 Task 的强制证据

```text
red.txt
green.txt
full-gate.txt
task-evidence/Bxx.json
sourceDigest
atomic commit
```

## 3. 数据不可变规则

- RawTrace/Oracle/Workspace Snapshot 一经发布不得原位修改；
- Golden 失败不能自动刷新；
- Gate Task 不能编辑运行数据；
- 评分修订产生新 revision；
- 不得删除失败、超时或负收益 Run。

## 4. Blocker 条件

仅当以下情况停止：

- 依赖 Evidence 缺失或哈希错误；
- Pi Public API 与固定合同不符；
- 需要修改允许文件集合之外的公共合同；
- RED 因环境而非目标行为失败；
- 存在数据破坏或真实副作用风险。

创建 `blockers/Bxx-<reason>.md`，不得用临时 hack 绕过。

## 5. Review

Reviewer 必须重跑窄测试、Schema/Manifest、随机抽取一个 Scenario 重放，并检查 Gate 是否按词典序执行。
