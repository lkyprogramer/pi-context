# Provider overflow (observed, not SUCCESS)

Current-HEAD live run: `report.json`. `autoCompact=false`, `overflowObserved=false`, `usedManualCompactAsOverflow=false`.

- Native peaked billed 191621 then usage 0; overflow-prompt still ok.
- PCR peaked 153801 then collapsed to 9547; no context-length error.

NF014 stays open.
