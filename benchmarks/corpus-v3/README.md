# corpus-v3

Publication-grade A1-shaped corpus. Each case is a directory:

```text
<split>/<caseId>/
  manifest.json
  session.jsonl
  store.json
  workspace/
```

Splits: `train/`, `dev/`, `locked-test/`, `real-traces/`.

Lock is fail-closed: `PCR_CORPUS_REAL_TRACES_MISSING` until desensitized real development traces are present. Templated family clones are not a substitute (NF021).

Verify:

```bash
pnpm benchmark:corpus:v3:verify
```
