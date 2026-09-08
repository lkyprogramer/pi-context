# 当前v5规格T01–T26一致性

评级表示产品运行链，不表示代码文件是否存在。基本满足不是独立全量测试通过；部分和未满足均给出下一任务。未执行可选语义不是扣分理由。

| 原任务 | 要求 | 判定 | 依据 | 修订任务 |
|---|---|---|---|---|
|T01|官方宿主与干净安装基线|部分|有真实stock安装测试和唯一入口；profile/config尚未接通|A01,E04|
|T02|冻结类型、配置schema与测试夹具|部分|配置schema与类型存在；负数NaN和嵌套未知字段未拒绝|A01|
|T03|原生entry读取与公共hook适配|未满足|错误session_compact.entry；生产自定义宽API掩盖错位|A01|
|T04|generation与生命周期失效|未满足|generation可回退；session_start/shutdown清理不足|C02|
|T05|来源ref、规范hash与UTF-8范围|部分|read原字段hash可用；projection/search/多块生产者不一致|B01|
|T06|工作区／分支授权与fork语义|部分|read祖先授权存在；index同ID跨session片段可见|B02|
|T07|派生SQLite索引与有界重建|未满足|persistent实际:memory:，worker未接、重复全量upsert|B02|
|T08|授权优先的搜索与稳定分页|未满足|offset未用，query/scope未绑，回声未排除|B02|
|T09|精确回读、图片与缺失源处理|部分|单块文本有成功信号；UTF8预算越界与图片合同错误|B03|
|T10|成功请求暴露账本|未满足|只验generation且用占位snapshot ACK；未据最终payload记录|C02|
|T11|完整工具批次和保护集合|部分|批次集合已有；错误字段和完整性/同branch过滤不足|C03|
|T12|最终预算与未知多模态成本|未满足|预算decision没有裁决最终消息；无实时完整envelope|B03,C03|
|T13|稳定epoch规划器|未满足|累计阈值后每请求重计划，未保持冻结epoch|C03|
|T14|纯投影renderer与保守日志摘要|部分|副本替换方向正确；错误hash/多块/未知块/预算需修|C03|
|T15|分支pin与原生摘要后的胶囊|未满足|错误compact事件，胶囊加user且quote/ref不可靠|C01|
|T16|完整usage账本与缓存收益模型|部分|usage helper存在；真实Pi字段/生产hook和attempt未联通|E01|
|T17|候选stage与宿主ACK恢复|可选延期|staging单测机器，不应影响核心observe/balanced generation|C02,C01|
|T18|可选语义压缩及B3消融|可选延期|semantic明确不支持；不纳入本轮必做|无|
|T19|工具／命令接线与真实打包|部分|命令与tarball安装存在；history图片转JSON、profile诊断不足|A01,B03,E04|
|T20|性质／故障／安全矩阵|部分|性质测试未包含本文15个反例，不能替代接线测试|E04|
|T21|编码沙箱与受限provider relay|部分|agent+broker隔离有效方向；host grader破坏整链隔离|E02|
|T22|同宿主配对runner与不可变run manifest|未满足|B2实际observe；manifest缺实际config/source；重试覆盖|E01,E03|
|T23|Java场景oracle与真实模型C2|部分|Java oracle存在；最后prompt泄露解法，C2只引导且环境nonce|E01|
|T24|运行评价与预注册晋级判断|未满足|异质C2加入quality数；null安全检查、成功子集资源比较|E01,E01|
|T25|切换唯一入口并删除旧运行时负担|基本满足|旧运行时删除、单包入口真实存在；旧配置文档待删|E04|
|T26|独立审查与发布候选门禁|未满足|limited-trial不能升级balanced；当前SHA无独立云run，需本地冻结包验收|E04|

本轮明确接受的范围调整：保持原生compact为唯一提交者，语义与复杂ACK延期；先修history，再启用balanced；不要求个人项目每次100×3。原生已接受消息为事实源，不恢复输入元数据补丁。
