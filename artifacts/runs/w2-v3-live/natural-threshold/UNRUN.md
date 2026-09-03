# Natural 200K threshold (observed, not SUCCESS)

Current-HEAD live run: `report.json`. `liveProvider=true`, `keepRecentTokens=20000`, `manualCompact=false`, `triggered=false`.

- Native tool-heavy: one compaction JSONL row, `tokensBefore=187164`, `fromHook=false`, `reason=null`.
- Native large-turn: billed 190061 then hang; no compaction.
- PCR both families: billed collapsed ~150–158k → ~9.5k with **zero** compaction JSONL rows.

NF014 stays open.
