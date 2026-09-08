Fix Deduplicator.java in this directory.

claim(tenant, eventId) must treat uniqueness as the pair (tenant, eventId), not eventId alone.
- first claim("A","event-1") succeeds (true)
- claim("B","event-1") also succeeds (different tenant)
- second claim("A","event-1") returns false
- claim("a:b","c") and claim("a","b:c") must both succeed (do not merge tenants)
- new Deduplicator instances must not share state
- null or empty tenant/eventId throws IllegalArgumentException

Use read/write/edit/bash as needed. Only modify Deduplicator.java. Reply DONE when saved.
