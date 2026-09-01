# B29 natural 200K (unrun / not observed)

Shipped: default keepRecent=20000 and reserve=16384, no manual compact, per-arm workspaces, per-turn usage recording, two families, persist to `artifacts/runs/w2-v3-live/natural-threshold/`. Fake `liveProvider` without a started Pi is `PCR_W5_FAKE_LIVE_PROVIDER`.

A live attempt (`PCR_W5_LIVE_PROFILE=natural pnpm test:live:w5`) timed out at 8 minutes with no threshold observation. NF014 stays open.
