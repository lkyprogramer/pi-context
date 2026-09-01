# Natural 200K threshold (awaiting live observation)

Runner no longer lowers keepRecent/reserve and does not call manual compact. This file remains until a current-HEAD live run records `reason=threshold` for both Native and PCR arms with per-turn usage.

Attempt: `PCR_W5_LIVE_PROFILE=natural pnpm test:live:w5` was started against local `~/.pi/agent/models.json` and timed out at 8 minutes with no `report.json` and no threshold observation.

NF014 stays open until that observation exists.
