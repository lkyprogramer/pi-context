# CI、构建与发布

## Required PR Checks

```text
lockfile-clean
format/lint
package-boundaries
typecheck
unit
integration
pi-contract
packed-install-real
vertical-acceptance
security-fast
benchmark-oracle-validation
```

## Nightly/Protected

```text
Pi version matrix
macOS/Linux
real provider paired smoke
performance/cache
crash fault matrix
```

## 发布包

- app `private:false`；
- SPDX license 明确；
- build 生成自包含 JS bundle + declarations；
- 不从 tarball 外相对导入；
- `npm pack` 后在空 PI home 安装；
- SBOM、checksums、compat lock、rollback manifest；
- 当前 CI failure 未关闭前禁止 release。
