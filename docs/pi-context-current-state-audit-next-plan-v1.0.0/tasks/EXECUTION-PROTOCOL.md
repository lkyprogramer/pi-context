# AI Agent 执行协议

## 启动

```bash
python3 scripts/taskctl.py init
python3 scripts/taskctl.py next
python3 scripts/taskctl.py claim A00 --owner "$AGENT_ID"
```

## TDD

1. 读取 Task、依赖 Evidence、相关 Finding、固定源码；
2. 写 RED test；
3. 运行窄测并保存真实失败；
4. 实现最小修复；
5. 运行窄 GREEN；
6. 运行 Wave/full gate；
7. 生成 Evidence JSON 与 SHA seal；
8. 原子 commit；
9. reviewer 只核验 evidence/代码/测试，不信自然语言完成声明。

## 禁止

- 禁止修改 locked corpus 修复实现失败；
- 禁止用固定 `true/0/1` 填 Hard metric；
- 禁止把 fake port 单测命名为 live；
- 禁止删除失败样本；
- 禁止把 missing credential 算产品失败或把产品失败算 skip；
- 禁止在 dirty tree 运行规范 Gate；
- 禁止未通过 W5 就开启 Semantic default。

## Blocker

无法满足 allowedFiles 或缺少宿主公共 API 时，提交 `artifacts/blockers/<task>.json`，包括源码证据、最小复现、候选方案，不自行扩大范围。
