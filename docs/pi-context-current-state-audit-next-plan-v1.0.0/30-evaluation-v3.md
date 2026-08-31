# Evaluation v3

## Arm 定义

### W1

- A0：Pi Native untouched；
- A1：Pi Native + PCR tool ingress/CAS/reducer；
- A2：A1 + proactive recall。

### W2

所有臂从**同一 A1-shaped Pi JSONL + Runtime Store snapshot**启动：

- B0：Pi Native compaction；
- B1：PCR deterministic checkpoint，identity context；
- B2：PCR checkpoint + PCR materializer + exact/proactive recall；
- F0：Full-context Reader/Executor ceiling（仅窗口允许的 boundary）。

## 三层结果

1. Artifact integrity；
2. Isolated reader probe；
3. Tools-enabled environment continuation。

## Corpus

- 至少 30 独立 cluster 做 smoke；
- Gate 100 cluster × 3 executor seeds；
- 中英双语不作为独立 cluster，属于 cluster 内变体；
- 包含真实脱敏 coding traces；
- locked-test major 冻结，失败后不可编辑同版本语料。

## 必测族

constraint、temporal correction、polarity、branch、tool-heavy、error→fix→verify、external side effect、recall-needed、recall-not-needed、recursive、overflow、prompt injection、secret variants、same basename different path。
