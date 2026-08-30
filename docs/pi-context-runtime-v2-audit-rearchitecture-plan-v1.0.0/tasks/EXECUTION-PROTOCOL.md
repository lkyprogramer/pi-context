# Task Execution Protocol

## Bootstrap

```bash
cp tasks/task-status.template.json .pcr/task-status.json
export PCR_AGENT_ID="agent-$(date +%s)"
python3 scripts/taskctl.py next
```

## State ownership

`.pcr/task-status.json` 是本地可变状态，不提交。每个 commit 的任务映射写 Git Notes 或 `artifacts/task-evidence/<id>/commit.txt`。

## Stop conditions

Agent 只有以下情况可停止：依赖 evidence 缺失；RED 是环境失败；需要越界改公共接口；检测到安全/数据损坏；上游 Pi 公共合同与锁定版本不一致。停止时必须写 blocker。
