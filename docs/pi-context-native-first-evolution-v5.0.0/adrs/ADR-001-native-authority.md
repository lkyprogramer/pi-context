# ADR-001 · 原生Pi为唯一会话事实源
状态：接受为v5目标。依据：S02、S07–S11、S29。

决定：删除patched ingress依赖，不接管input；以已持久化native entry建立索引。取消host-agnostic runtime作为公共产品层。代价：不再承诺保存或认证UI原始输入与所有中间转换；普通RPC/interactive只能作为传输来源。

替代：继续PCR patch能提供更强元数据，但违反官方插件目标；开发fork不是本次选择。验收：G0/G1、T01/T03/T25。未来官方公开支持稳定ingress元数据后可读取，但仍不要求它才能加载。
