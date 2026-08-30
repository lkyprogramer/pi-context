# Storage、Saga 与恢复

## 物理隔离

```text
${PI_CONTEXT_HOME}/workspaces/<workspaceHash>/
  runtime.sqlite
  blobs/sha256/<shard>/<blobId>.bin
  keys/
  spool/
  backups/
```

每 workspace 独立数据库、key domain、FTS statistics 和 GC。禁止跨 workspace SQL join。

## Saga States

```text
prepared → runtime_durable → host_visible → acknowledged → committed
                      ↘ orphan / stale / failed
```

## 恢复不变量

- toolCallId + contentHash 重放不产生重复 Evidence；
- host entry 已写而 ack 缺失时可补 ack；
- candidate prepared 后 branch/model/config 变化必须 stale；
- blob 永远先于 compact view 返回；
- GC 只能删除无任何 durable receipt 引用且超过 horizon 的 blob。
