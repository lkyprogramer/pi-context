# Code Review Checklist

- [ ] No fixture IDs/default business values in production composition.
- [ ] All new public types are defined once in contracts.
- [ ] Error path has deterministic fallback or documented hard stop.
- [ ] Source class and authority cannot escalate.
- [ ] Stable IDs do not use array index/time alone.
- [ ] Narrow RED and GREEN logs attached.
- [ ] Full gate passed on clean tree.
