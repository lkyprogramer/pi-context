# 最新报告的证据与判定

## 目前能确立什么

项目迭代记录 `https://github.com/lkyprogramer/pi-context/blob/7478307ead72e849e9c619a913858afe8a06d38b/docs/iterations/native-first-v6.md` 自报run `20260909-112407` 共37/37完成：L01–L06每格2/2；H01 balanced恢复nonce且有折叠计数；H02错误结果没有进入计划；H03未达到触发阈值。H01/H02 engine prefill比例1.04、1.08，表示候选多4%/8%预填充计数。它没有宣称全模型普遍优于Native，default observe值得保留。

**本轮不能重新计算这些37个episode。** 归档缺该run的requests/folds/episode结果/metrics-before-after。`reported-trial-claims.json`只登记自报，不是重跑结果；`source-probes.json`是另行构造输入验证当前函数，不是Live重新打分。run HEAD19080243、dirty说明、后续tarball SHA不能靠README自行组成完整身份闭环。

## 关键问题1：质量门评价了未发生的机制

场景文件直接写明L01–L06在w262k不触发fold。它们对验证工具schema干扰和普通Java工作很有用，但不说明旧日志被替换成stub之后模型还能完成历史依赖任务。

H01/H02使用w64k是诊断窗口，这本身合理；需标记不能直接推广为262k生产窗口结果。H03仍folds=0，因此没有生产窗口压力验证。H02丢失原文引用2/2应是需要定位的重要症状；不是已经证明某类新记忆注入一定有效。

## 关键问题2：算法门可被确定性反例击穿

实际 `decide()` 对每题2rep只拒绝候选比Native少2次。构造六题Native全过、每题候选只过一次，即12/12对6/12；加满足现有能力字段、H02引用失败、prefill增加40%，仍返回 `limited-balanced-trial`。这是Gate逻辑反例，并非真实run退化50%的断言。

H01至少一个恢复通过即可；H02只检查foldedErrorResults=0，不检查quotedVerbatim；成本只排除prefill>1.5×。文案“quality, mechanism and cost gates passed”掩盖了这些门事实上允许什么。

## 关键问题3：Pi usage分桶不能再做二次相减

官方Pi参考源码openai-completions适配器计算 `input=max(0,prompt_tokens-cacheRead-cacheWrite)`；对应logical input为 `input+cacheRead+cacheWrite`，未缓存值已经是input。故cacheRead>input通常只是缓存命中多，并非自动无效。

当前表用input-cacheRead，恢复门用cacheRead/input。100 fresh+60 cached下，真实hit=37.5%，当前门得到60%。这条错误独立于私有服务是否准确返回raw usage。应锁定安装包适配器和Provider raw SSE的映射，字段缺失/违反约定才置unknown；不可拿clamp后的0当已知零，也不可为了好看切换分母。

## 关键问题4：成本、重试与paired统计

`loadEpisodes`保留最后一条；timeout1000tokens后成功10tokens只报10。`median([10,100])`返回100。blocked从主表删去，且没有保证每个planned key最终存在。修复后同时输出首次尝试成功率、声明重试策略后的完成率，以及全部尝试成本；不把sample中位数当2%非劣。

Engine指标是物理工作量代理，不是模型计费，也不是峰值显存。全局counter差须证明独占、同model/context config、无reset、所有请求均属本episode。否则仅做观测，不能兜底货币成本。prefill多4%/8%也不自动意味着wall更慢，需完整墙钟、输出tokens和重试并列。

## 最短补证方式

不重跑旧37组。先修R02/R03/R04/R06/R07/R08，然后跑受控Pi链路验证真实fold和cursor。保留原六题为廉价开发回归，新增8个after-fold历史必要任务，最多32个主比较episode+4个独立恢复能力episode。若依旧没有净改善，就停在observe/history，不为凑架构加层。
