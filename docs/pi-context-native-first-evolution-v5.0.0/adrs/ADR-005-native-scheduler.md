# ADR-005 · 只有Pi调度压缩与重试
状态：接受为v5目标。依据：S07–S08、S18、S27–S28。

决定：不在turn_end/agent_settled启动自建压缩循环，不创建新会话续跑，不重放工具。可选语义层通过公开before_compact提供候选，matching native ACK后生效。代价：不能完全控制每次压缩时机；原生估计可能比投影视图保守。

验收：T04/T17/T18/T20。若未来官方新增安全pre-send策略API，再在公开契约下演进，不能私自挂接内部agent对象。
