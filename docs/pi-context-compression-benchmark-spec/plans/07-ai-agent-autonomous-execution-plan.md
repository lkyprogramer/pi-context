# AI Agent 自主执行与审查计划

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 每个 Task 的固定循环

```text
check dependencies and source digest
→ claim task/worktree
→ write RED
→ verify RED reason
→ implement public contract only
→ add negative/fault/golden tests
→ run narrow GREEN
→ run full gates
→ seal evidence
→ commit
→ independent review
```

## Agent 不得自行决定

- 调整 Gate margin；
- 删除失败场景；
- 更新 Oracle 以适应输出；
- 用 Judge 覆盖确定性失败；
- 修改前置 Task 的公共合同；
- 引入 Pi 私有 API。

出现上述需求时生成 `blockers/Bxx-<reason>.md`，由架构决策者处理。
