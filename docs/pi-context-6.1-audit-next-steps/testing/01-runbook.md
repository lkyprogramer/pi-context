# AI本地执行手册

## 0. 环境与源码

```bash
node --version
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
git status --short
git rev-parse HEAD
```

需要Node≥22.19.0（建议锁22.19.0或项目已验证的24），Pi0.85.1和锁文件依赖。不得把host22.17“能跑”写成满足engines。工作区dirty时可以诊断，但证据manifest必须绑定完整差异；正式集中比较用干净实现commit，报告commit可随后独立提交。

## 1. 修复期间

按tasks/Rxx运行定向命令；每次`pnpm typecheck`。R01新增聚合命令之后：

```bash
pnpm check
pnpm smoke
```

check调用当前兼容源码/测试，不运行历史PCR tests目录。smoke为实际tarball+官方Host受控Provider。Docker不可用则smoke相关项BLOCKED，不伪造绿色。

## 2. 沙箱（R06后）

```bash
node eval/local/secure-preflight.mjs --canary
```

此入口由R06实现。它用随机合成canary key证明Agent的env、models.json、挂载和网络不能拿到真实Key；判题容器不挂broker。H03不得加`--no-sandbox`。真实Key只进入父Broker内存，测试日志禁止打印。

## 3. 冻结计划（R08/R09后）

```bash
node eval/local/run-matrix.mjs --mode controlled --config eval/local/review-matrix.json --out artifacts/local-eval/review-controlled
node eval/local/run-matrix.mjs --mode live --config eval/local/review-matrix.json --out artifacts/local-eval/review-live
node eval/local/report.mjs --run artifacts/local-eval/review-live
```

这些flags由R08统一实现；在此之前不能声称已有命令可直接执行。`mode=live`还要求显式PCTX_LIVE=1与用户提供endpoint；缺失则BLOCKED。不得自动搜索/调用其他商业Provider。运行器打印当前episode/预算/完成数，不承诺后台送达。

默认预算：36 episode、每个最多24模型请求/48工具调用/600秒；全run最多600模型请求/720工具调用/3600秒，任一先到则停止，未跑项为NOT_RUN，不能从分母删除。预算是首轮上限，可在冻结前根据目标模型调整，不在run中增加。成本上限如价格未知用null，不伪装成0美元。

## 4. 检查结果

依次核对manifest、activeProfile、实际foldApplied、原文恢复、环境oracle、所有attempt成本、Pi usage来源和engine独占性。先看错误链，再看汇总。`exit 0`只代表生成了报告，不等于recommendation通过。

输出应有：manifest.json、plan.json、attempts.jsonl、requests.jsonl、folds.jsonl、oracle.jsonl、report.json、REPORT.md、MANIFEST.sha256。无正文的事件足以复算；私密raw session单独留本机，不进ZIP。重新计算报告必须只读run内配置，不依赖当前仓库cases.json。

## 5. 退出策略

all-pass且有预登记收益：个人显式limited试用，默认仍observe。
无收益但history有用：保留observe/history，不继续扩层。
候选新增失败：保留trace并定位，最多一次小型成对诊断，不自动重跑全部直到通过。
缺环境或证据：输出BLOCKED/INCONCLUSIVE，不把缩小样本当原计划完成。
