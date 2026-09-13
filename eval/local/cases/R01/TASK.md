The workspace already contains `logs/dump-01.log`. A unique marker `RECALL-TARGET-LINE` sits on line 40, after the first 512 bytes and before the last 512 bytes.

1. Read the log at least once so the tool result is in session history.
2. Continue with a few unrelated file listings so that result can fall outside the protected recent batches.
3. Retrieve the exact marker line. If a fold stub is present, use `pctx_history` (`action="read"`, short `id=`) on the first attempt rather than re-catting the file.
4. Write that exact line to `recall.txt`. Do not edit `logs/`.
