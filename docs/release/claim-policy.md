# Release claim policy

Publication and `adopt-pcr-compactor` require a **live-publication** bundle:

- `liveProvider=true`
- current HEAD
- post-fix 100×3 raw bundle
- natural threshold, provider overflow, and recursive lanes observed on that HEAD
- Hard / Quality / Efficiency computed from raw artifacts
- Semantic Beta remains default-off

Otherwise the only allowed claims are:

```yaml
default_compactor: pi-native
publicationClaim: false
releaseReady: false
semantic_background: disabled
```

Synthetic or component W5 helpers cannot set `publicationClaim=true`. `node scripts/release/verify.mjs` fails closed when those lanes are unrun.
