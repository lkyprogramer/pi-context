# 可复现性与 Run Manifest

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 每个 Run 必须落盘

- benchmark config hash；
- corpus/oracle/snapshot hashes；
- Arm package/tarball integrity；
- Pi/Node/OS/arch；
- model/provider/API revision；
- prompt/tool/reducer/catalog revisions；
- random seed；
- cache mode；
- start/end time；
- raw stdout/stderr/events；
- artifact/report hashes；
- infrastructure exclusions。

## 2. 运行目录

```text
runs/<runId>/
  manifest.json
  config.json
  corpus.lock.json
  arms/<armId>/manifest.json
  scenarios/<scenario>/<arm>/<replicate>/
  aggregate/report.json
  aggregate/report.md
```

## 3. Determinism Check

确定性 Arm 同 Snapshot、Config、Seed 重跑 3 次，`compressionArtifact.outputHash` 必须一致。Provider 参与的 Arms 不要求字节一致，但要求配置完整记录。

## 4. 原始证据不可覆盖

重新评分生成新 `scoringRevision` 和新报告，不改写原始 Run Events/Artifacts。

## 5. 时间与价格

价格快照带生效日期和来源；后续重算成本时保留“运行时价格”和“重算价格”两个视图。
