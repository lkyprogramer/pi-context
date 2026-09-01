# B17 lease durability blocker (honest)

Default materializer view now includes:

- `directory` from evidence pointers (max 16)
- `retrieval-page` when proactive recall is needed
- `runtime-warning` listing active purpose-bound leases (`leaseId`, `pageId`, `purpose`, `authority`, `expiresAt`)

Lease **grant/renew** still uses the in-process `owner.leases` Map. B17 allowed files do not include a storage schema/migration. Restart therefore drops leases even though evidence pointers and recall quotes survive SQLite/CAS.

Do not close NF017 as a durable lease store until a later task adds a persisted lease table (or equivalent) under an explicit allowed-files expansion.
