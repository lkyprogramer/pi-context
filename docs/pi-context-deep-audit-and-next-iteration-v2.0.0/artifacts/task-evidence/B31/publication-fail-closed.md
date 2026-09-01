# B31 publication fail-closed

`createGateEngine` will not `adopt-pcr-compactor` unless `liveProvider=true` and `publicationClass=live-publication`. `node scripts/release/verify.mjs` exits `PCR_PUBLICATION_RUN_MISSING` while the 100×3 / W5 live lanes are unrun.

Semantic Beta remains default-off. `publicationClaim` stays false. NF015/NF024/NF027/NF028 stay open.
