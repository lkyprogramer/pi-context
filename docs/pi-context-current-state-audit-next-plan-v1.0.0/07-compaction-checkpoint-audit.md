# Checkpoint 与 Compaction 审计

## 当前 checkpoint 的窄优势

- 确定性；
- 不需要摘要 LLM；
- literal directive 保留好；
- 不复制 raw tool dump；
- artifact 很短、前台快。

## 当前语义缺口

- Continuity 为空；
- task fronts/errors/validation/side effects 缺失；
- Claim 只从临时 Directive parser 生成；
- English temporal assignment 错误；
- pointers 不是 snapshot catalog；
- pointer verifier no-op；
- prior checkpoint state 未可靠合并；
- model-visible hash/head/ID 占成本，但对任务帮助未消融。

## 推荐 v2.1 格式

模型可见：

```text
PCR checkpoint
constraints:
- do not deploy production [d:7f3a]
state:
- version = 7 [c:91bd]
fronts:
- active: fix authentication failure
errors:
- auth.test failed, unverified [e:13af]
next:
- rerun auth test before any deploy
```

审计元数据放 `CompactionResult.details`：完整 hashes、heads、source snapshot、pointer list、verifier receipt。只有需要模型主动 recall 的短 ref 放 summary。
