# 可重复使用的三层验证协议

## G0：每次修复的确定性反例

定向Vitest + pnpm typecheck，零模型请求。只证明代码行为：实际字段映射、来源授权、batch完整、分页、计量、Gate、沙箱。所有negative和positive control都保留。不得把缺依赖/不可用Docker当功能红测；这类是BLOCKED。

## G1：真实官方宿主+受控Provider

从真实tarball加载进Pi0.85.1，不从monorepo src导入冒充安装。Provider可编程返回消息，但不伪称真实模型质量。用小诊断窗口触发流程，观察最终payload而非只观察插件plan：原文首发→成功assistant→足够旧且压力达标→真正fold→history多轮翻页→native compact→restart/branch再读。

必须覆盖：最近4批保护、错误保护、两调用/两结果、重复ID、未消费批次、图片、跨session同ID、archive未进入当前view、Provider error/abort、overflow willRetry、模型切换、search/read游标。建立caller-owned时钟和使用量，性能阈值不放Unit硬编码decision。

## G2：小型质量与收益实验

只在G0/G1和R06沙箱通过后运行。主臂：B0=Pi Native，无PCR；B2=同宿主+PCR balanced。工具增加本身属于产品差异，必须计Schema成本。一次targeted ablation可用observe/history-only定位收益来自history还是fold，但不能把这个第三臂与主分母混合。

8个历史必要质量任务 ×2重复 ×2臂=32个episode。另2个candidate-only精确恢复能力任务×2=4个episode，共36。两个no-fold/image guard使用受控Provider，不再花真模型调用。每任务关联一次先前工具观察/约束，最后prompt不重复答案或给出修复代码。

质量样本必须满足：B2实际最终请求至少一次应用fold；预期事件不在raw tail但可回读；B0/B2同一冻结session/workspace/source/模型/预算；各arm独立文件系统。原生compact是否发生单独分类；做pure-fold对比时两臂均不能强制一个独有compact，做after-native-compact子集时冻结同一cut/seed并按真实host事件确认。

## 失败、重试与决策

所有planned episode始终在ITT分母。默认无语义补救重试；允许一次预登记transport-only重试时，同输入、同工件、同预算，保存两次attempt并累加成本。超时/empty-turn后追加“继续/再试一次”属于另一种策略，不得覆盖第一次结果或声称同一采样条件。

任何安全/关键约束/错误动作失败直接回到observe；普通候选新增失败标`review-needed`，不因每题只少一次而忽略。未真正fold为`mechanism-unexercised`，不是候选成功。H02引用题要求精确来源quote（oracle中提前定义），不把答案中“似乎记得”算成功。

只有质量、机制、安全均满足且至少一个预登记目标有改善，才建议limited-balanced-trial。默认目标可选完整token工作量/完整墙钟/可靠性；不能看完数据后选择最有利目标。资源型默认净改善阈值10%只是个人试用工程阈值，不是数学最优或2%非劣证明。质量优先目标可接受预登记的小资源代价，但需要真实质量增益，不用“cost gate允许1.5倍”替代收益。

成本/usage不完整时只给`quality-qualified-cost-unknown`，不升级“更便宜”。主模型不支持seed则称replicate，不伪造受控随机种子。第二个重复不是新的独立任务；置信分析以task cluster为单位。
