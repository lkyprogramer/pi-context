# Token、Cache、Engine与统计的唯一口径

## Pi分桶 vs 原始OpenAI协议

Pi OpenAI-completions适配器在参考源码中执行：

```text
Pi.input = max(0, raw.prompt_tokens - raw.cached_tokens - raw.cache_write_tokens)
Pi.cacheRead = raw.cached_tokens
Pi.cacheWrite = raw.cache_write_tokens
Pi.output = raw.completion_tokens  # 已包含reasoning，不能再次相加
```

所以对已确认该映射的Pi usage：

```text
fresh_input = input
logical_input = input + cacheRead + cacheWrite
cache_hit_ratio = cacheRead / logical_input  # logical为0时null
```

对原始协议inclusive usage：logical_input=prompt_tokens；fresh=prompt_tokens-cached-read-cached-write，必须检查总量非负且分桶不超过prompt。不同Provider字段的缺省语义需由小型adapter显式确认。没有确认映射时返回unknown，不能拿cacheRead>Pi.input当协议违规，也不能让clamp掩盖raw不一致。

示例Pi input100/cacheRead60/cacheWrite0：logical160、fresh100、hit37.5%。Pi input40/cacheRead60合法，hit60%。原始prompt100/cache60：logical100、fresh40。三组不能混用。

## 原子计量对象

每个wire request具有requestId、episodeId、attemptId、purpose、provider/model、映射版本、终态、usageObserved、各分桶null或整数。请求没有usage不代表0；未发出的请求可以明确标not-sent=0。物理transport重试的usage未知要使成本coverage<1。

同一请求由hook、session message、broker多处观测时按主身份去重；不能因重试输入Hash相同而合并两个真正的请求。Native摘要usage单列purpose=compaction，并与会话重复条目去重；没有ID时明确来源优先规则和不确定性。

完整episode成本=所有attempt所有请求（agent+compaction+retry）的成本。最终状态可用最后允许attempt，first-attempt成功率也必须单列。所谓成本每成功任务：所有计划内尝试总成本/成功episode数；成功数0返回null或infinite语义，不返回0。

## 费用与物理计算

monetary cost仅当价格和usage各必需分桶已知：fresh*priceFresh + cachedRead*priceRead + cachedWrite*priceWrite + output*priceOutput。单位明确每百万tokens或整数微货币。Pi未知价格返回0时必须用pricingIdentity判断，不能当免费。

engine prefillTokensDelta是实际物理工作量代理，必须同server/model/slot策略、无counter reset、episode独占才可归因；其他并发Agent会污染全局差。engine prefixHit和Pi cacheRead语义不同。两者分列，不用一个修补另一个。

TTFT定义request-send到first provider content/tool delta，不是message_start到message_update。当公开Hook无法观察真正send，命名为hook-to-first-delta，标测量范围，不能装成网络TTFT。

## 统计

偶数n的median为中间两项平均。配对成功率差=mean(candidatePass-baselinePass)，不是median(binary difference)。两次重复按同task cluster聚合；小canary仅描述区间/逐任务差，不声称2%非劣。展示整体ratio和paired relative median，两者不同，均说明分母。

所有missing/not-run/blocked/timeout在ITT计划保留。complete-case可作附表，不替代主结论。至少输出planned/attempted/completed/graded/after-fold-eligible各分母，exactRead同样报告eligible次数，不把n/a当全过或全失败。
