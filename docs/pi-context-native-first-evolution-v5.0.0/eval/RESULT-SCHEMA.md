# 实验记录契约

每行一个`EvalPair`，类型见`contracts/model.ts`。taskId与clusterId由冻结语料清单提供，不能由模型自行修改。baseline/candidate都必须保留状态；未完成时taskPassed和criticalViolation为null，禁止默认false掩盖“未观测”。

`kind=synthetic-example`是脚本演示，不得并入real-run主分析。provenance记录real-independent/adapted-real/synthetic，主质量声明需解释语料来源。所有记录应另带不可变run manifest（宿主、源码、配置、模型、价格、镜像、oracle hash和时间）；统计脚本只处理已经形成的pair，不证明这些运行来源真实。

脚本报告不利cluster比例的保守上界、完整性和已知费用变化；不自动写出release-approved。missing cost不是0，缺失配对不是both-pass。关键约束违规单独阻断，不能由candidate其他胜出抵消。
