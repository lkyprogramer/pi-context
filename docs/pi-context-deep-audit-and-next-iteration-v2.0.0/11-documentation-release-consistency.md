# 文档、兼容性与发布一致性

## 发现

- `HANDOFF.md` 仍以旧 T00–T54/旧 Live 结果为主，未反映 A00–A50 和当前 Head；
- `docs/COMPATIBILITY.md` 与 `INSTALL.md`/Pi Lock 的 0.84.4 口径不完全一致；
- `docs/OPERATIONS.md` 容易让人误以为 verify-protection 已应用 GitHub 规则；
- `apps/pi-context-runtime/package.json` 仍为 `private:true`、`UNLICENSED`、`npmPublish:false`；
- Gate artifact 绑定 `8855d45`，不是当前 `6c5c5b5`；
- Compatibility workflow 失败，所以“release matrix 完成”不成立。

## 当前发布定位

只能定位为：

```text
Internal alpha tarball
Requires patched Pi 0.84.4 host contract
No npm publish
No public compatibility promise
Pi Native remains default compactor
```

## 修正文档原则

每个用户可见文档都必须从一个生成的 `CURRENT-STATUS.json` 读取：HEAD、Pi version、package policy、required/compatibility status、latest authoritative gate、publication claim。禁止手工复制旧结果。
