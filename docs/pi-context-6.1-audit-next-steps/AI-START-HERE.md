# AI 自主执行入口

先读取 `audit/00-verdict.md`、`audit/03-findings.md`、`design/00-target.md`、`testing/00-protocol.md` 和当前任务。不要把归档的PCR/DSH规格重新当作活动需求。

目标仓库基线：`7478307ead72e849e9c619a913858afe8a06d38b`。代码位于 `src/`，活动测试位于 `test/`，活动模型实验位于 `eval/local/`。若HEAD变化，先检查与相关文件的diff；不得覆盖用户未提交改动。

执行顺序：R01 → R02 → R03 → R04 → R05 → R07 → R08 → R09 → R10；R06可在R01后独立执行，但任何模型Live必须等R06通过。R02/R03/R04/R05/R07都会影响共享入口，禁止并行改同一文件。

## 每任务唯一流程

1. 运行任务RED，仅目标行为失败才是有效红测；依赖缺失不是功能红测。
2. 最小修改，使目标测试通过；保留反向/边界例。
3. 跑该任务定向测试与 `pnpm typecheck`。将命令、exit、变更文件、尚未验证边界记到 `docs/iterations/next-fixes.md` 的该任务段。
4. 一个可审查commit。无需新任务数据库、签名receipt或自动push。跨文件必要变化在该段记录，不为形式上的文件白名单制造兼容层。
5. 只有R10集中执行完整check/smoke和有预算的live。修复不能通过删除负例、调整oracle或提高限额伪装成功。

## 允许自主决策

局部函数拆分、删除dead code、替换失效旧workflow、补充负例均可。不得修改默认observe、折叠60/40/4096/最近4批参数、生产模型/输出预算、删除原会话、调用外部部署/支付/发送消息、读取真实密钥用于测试断言。Provider调用限于用户明确提供的测试服务，通过无凭据Agent代理；缺环境时记录BLOCKED且不替换成模拟Live。

## 完成判据

“代码存在”“测试名叫live”“脚本exit0”“文档写done”都不是完成。每个修复必须有对应反例现在不再成立；每个效果结论必须有实际最终请求和环境oracle。新profile hash、退出条件、cursor必须在真正的Pi工具往返中验证。

本包 `scripts/reproduce_source.mjs` 会诊断当前基线；它不是产品测试替代。`scripts/test_reference_metrics.py` 验证审计计算，不是模型质量证明。
