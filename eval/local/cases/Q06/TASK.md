Continue the Java workspace already in this directory. Use facts recorded earlier in this session when a historical value is required. Do not invent ticket identifiers. Ignore sibling-branch leftovers.

Fix TenantRepository.java in this directory.

findAll(tenant) and findOne(tenant, id) must be tenant-scoped.
- findAll("A") must not include rows from tenant B
- findOne("A","same") must return A's row, not B's row with the same id
- findOne("missing","same") must return null
- the caller may invoke clear() on the list returned by findAll; that must not throw and must not change later findAll results (return a mutable copy, not an unmodifiable view)

Use read/write/edit/bash as needed. Only modify TenantRepository.java and the follow-up file named below.

按当前分支有效约定修复仓库查询，并保存其trace ticket到 ticket.txt，一行、无其它文字。
