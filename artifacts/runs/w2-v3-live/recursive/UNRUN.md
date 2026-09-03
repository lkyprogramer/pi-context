# Recursive long-horizon (observed as hand compact)

Current-HEAD live run: `report.json`. `threeCompacts=true` after growing between compacts.

- compact-1 `fromHook=true`; compact-2 native fallback `fromHook=false`; compact-3 `fromHook=true`.
- Attempt 1 (`attempt-1-session-too-small.json`) failed compact-2 with session too small.

This is `rpc.compact()`, not natural 183808. NF014 stays open for the natural/overflow half.
