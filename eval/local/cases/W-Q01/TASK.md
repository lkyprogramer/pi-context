## P1
Before anything else run: cat notes/dump-a.txt then cat notes/dump-b.txt (two separate tool calls). Reply with one line per file.

## P2
Continue the Java workspace already in this directory. Use facts recorded earlier in this session when a historical value is required. Do not invent identifiers.

Fix Deduplicator.java in this directory.

claim(tenant, eventId) must treat uniqueness as the pair (tenant, eventId), not eventId alone.
- first claim("A","event-1") succeeds (true)
- claim("B","event-1") also succeeds (different tenant)
- second claim("A","event-1") returns false
- claim("a:b","c") and claim("a","b:c") must both succeed (do not merge tenants)
- new Deduplicator instances must not share state
- null or empty tenant/eventId throws IllegalArgumentException

Use read/write/edit/bash as needed. Only modify Deduplicator.java and the follow-up file named below.

完成之前记录的去重契约修复，并把所遵循的历史契约revision写入contract-revision.txt。不要更改public API。
