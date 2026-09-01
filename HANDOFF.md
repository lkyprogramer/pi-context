# HANDOFF

## 当前任务

下一轮执行入口是 `docs/pi-context-deep-audit-and-next-iteration-v2.0.0/`（W0 `B00–B07` 起）。审计对象 HEAD 为 `6c5c5b5ace3c14ea28535de9de2b95cc4fa40a31`。

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
