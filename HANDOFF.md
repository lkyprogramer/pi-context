# HANDOFF

## 当前任务

### v3 W5 continuation (2026-09-04)

当前代码已完成 C19/C20/C24 的增量修复（transport attempt 记录、planned/complete-case/worst-case 统计、corpus/session source binding、partial rows fail-closed、权威 live verifier）；C25–C28 也已有实现与定向测试。真实 Provider live evidence、Evidence v3 和 C24 300-pair gate 仍未完成；发布决策继续保持 `keep-pi-native` / `publicationClaim=false`。按用户要求，300 gate 延后至全部开发任务完成后执行一次。代码 HEAD 以接手时 `git rev-parse HEAD` 为准，本文件不硬编码易漂移的 commit。

W5 continuation additionally records the interrupted Pi live runs in `artifacts/runs/w2-v4-live/LIVE-COMPARISON.md`. The tracked RC manifest is a sanitized bundle index only; it must be regenerated in the final release job so its `commit` binds the release checkout HEAD. A locally committed manifest can become stale after the commit that updates it and is not release evidence by itself.

The post-fix bounded v14 recursive smoke reached a terminal report and verified fork/branch pointer/correction evidence, but restart continuity and three-compaction criteria remained false. A subsequent v15 smoke verified cross-session restart continuity and branch lineage; Provider correction/compaction assertions still failed. Both are retained as fail-closed evidence, not a C27/C28 acceptance result.

下一轮执行入口仍以 `docs/pi-context-current-head-audit-and-autonomous-remediation-v3.0.0/` 的未完成任务和当前工作树为准；审计附件中的旧 HEAD 仅作为历史基线，不代表当前实现 HEAD。

不要再 claim 上一版 `T00–T54` / `A00–A49` 为已验收完成。上一版 declared-done 已与 acceptance 分离；`A43`/`A44`/`A45`/`A48` 必须保持 reopen，直到对应 Live Lane 真正通过。

不要自行 publish / deploy；push 需用户明确授权。

## 当前产品决策

```text
default_compactor: pi-native
pcr_checkpoint: shadow-or-explicit-experimental
semantic_background: disabled
publicationClaim: false
releaseReady: false
npmPublish: false
```

## 已观察（审计时）

- Required run `33478592667` 在审计 HEAD 上绿。
- Compatibility run `33478592798` 在 Ubuntu / Node 24.18.1 / Pi min `0.84.4` 红：unit 里的 W1 Gate 吃了 wall-clock `hookP95Ms`。
- 修复前 100×3 与修复后小样本不得合成“既保指令又降 72% 输入”。
- Natural threshold / provider overflow / recursive 三次压缩均未验收通过。

## 绝对不要再踩的坑

- 不要把 YAML job 名自检写成 Branch Protection 已应用。
- 不要在 Unit 中断言真实墙钟性能。
- 不要用空壳 `evidence.json` 把任务标 Done。
- 不要把 Compatibility 的 `continue-on-error` advisory cell 算进 supported matrix。
- 不要自行 npm publish。push 需用户明确授权。

## 关键文件 / 命令

```bash
export NVM_DIR=/Users/luo/.nvm
. /usr/local/opt/nvm/nvm.sh
nvm use v22.19.0

python3 docs/pi-context-deep-audit-and-next-iteration-v2.0.0/scripts/taskctl.py next
pnpm test:unit
pnpm test:contract
node scripts/ci/github-protection.mjs verify
```
