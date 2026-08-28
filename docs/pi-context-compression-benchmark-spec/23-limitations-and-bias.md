# 局限、偏差与解释边界

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 模型依赖

压缩产物对某个 Reader/Executor 友好，不代表对所有模型同样有效。报告必须按模型分层。

## 2. 轨迹选择偏差

真实成功轨迹偏向可解决任务；失败轨迹也应纳入，避免只测“容易被摘要”的会话。

## 3. Oracle 不完备

Oracle 只能覆盖标注过的事实；未标注内容不能被当作“安全丢弃”。Closed-loop 和 Blind Review 用于补充。

## 4. LLM Judge 偏差

Judge 偏好长、流畅或与自身表达相近的摘要。必须盲化、校准并保留分歧。

## 5. Provider 随机与缓存

Provider 更新、路由、缓存 TTL 和安全过滤会影响结果。所有元数据必须锁定，重复运行报告方差。

## 6. 合成语料过拟合

Synthetic 精确评分非常重要，但不能替代真实 Coding Trajectory。Gate 同时需要 synthetic hard cases 和 real redacted cases。

## 7. 不能声称的结论

单个 Benchmark 不能证明“全场景最优”或“无损”。正确结论应限定 Corpus、Pi 版本、模型、配置和置信区间。
