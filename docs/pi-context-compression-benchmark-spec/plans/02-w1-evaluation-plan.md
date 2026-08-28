# W1 Early Net Value 实施计划

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 目标

实现并评测 A0/A1/A2，不提前引入 W2 Materializer。

## 工作流

```text
RawTrace
  ├─ A0 pass-through → Pi Native
  ├─ A1 W1 reducer/CAS → Pi Native
  └─ A2 W1 reducer/CAS + proactive recall → Pi Native
```

## 必须完成

- B06：A1/A2 Runner 与 Composition Guard；
- B08：静态 Coverage/Leak/Pairing；
- B09：Blob Recoverability；
- B10：Recall-needed/not-needed；
- B12：Closed-loop continuation；
- B13：经济性；
- B15：配对统计；
- B16：60 Boundary Corpus；
- B17：机器 Gate。

## 禁止

- 用 A0 压缩后的 Session 作为 A1/A2 输入；
- 把 PCR Materializer 的收益计入 W1；
- 只比较压缩率；
- 只选择主动 Recall 成功触发的样本；
- 失败/超时从分母删除。
