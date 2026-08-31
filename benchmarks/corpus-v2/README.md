# corpus-v2

Source-witness locked corpus for Evaluation v3.

- 30 independent clusters × 6 cases
- train / dev / locked-test splits via `createCorpusGovernor`
- each case carries `oracleExpected` that must appear in `body`

Verify:

```bash
pnpm benchmark:corpus:verify
```
