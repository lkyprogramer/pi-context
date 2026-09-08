# Independent review (T26)

Reviewer subagent on v5/native-first after the six-item batch. This is **not** implementer self-endorsement.

## Must-fix (recorded)

1. **ITT splice:** A merged `report.json` reused wallMs from an earlier tarball. Treat G4 8-pair both-pass counts as mixed-vintage unless a full `eval/smoke.mjs` is re-run on the current tarball.
2. **J05 `historyCalled`:** Previously a substring match on entries/TASK (`pctx_history` in the prompt). Tightened to `toolCall.name === "pctx_history"` / `toolName`. Sessions moved off `/work` to `$HOME/sessions`.
3. **J03 B0 `blocked` vs `failed`:** Maven/oracle non-execution must stay `blocked`, not rewritten as “did not fix”.
4. **T17/T18:** Unit machines exist; `session_before_compact` still returns undefined (native compact). Do not advertise a production semantic path. `acked` is not a distinct persisted state; crash-restore from native CompactionEntry is unproven.
5. **G0–G5 table** must keep commands/hashes; this freeze restores identity split (`designPackSource` vs `installedNpmGitHead`).

## Non-blocking

- Default semantic off.
- J03 fixture is Spring TX + H2 self-invocation, not Spring Boot.
- J06 uses `SessionManager.branch`; HINT file removed. Oracle `cwd: grade` was required to read `Writer.java`.
- Host identity mismatch recorded honestly; do not git-checkout `9767ba2`.
- Recommendation remains **observe**. `twoPercentNiClaimAllowed` is false.

## Follow-up freeze (unspliced 8×2)

Same-tarball smoke `53dbdb0a…` wrote `report.json` with plan/elapsedMs/manifest (no python splice of wallMs). G3 `live-c2.mjs` `recoveryPathProven: true` on that tarball. Smoke J05 still `historyCalled: false`. Recommendation **observe** (both-pass 5/8). T17 ACK states split in unit tests.

## After-review code changes

- `g4-agent.mjs`: real tool-call history detection; session dir under `$HOME`.
- `staging.ts`: reject empty ACK hash.
- `docs/release-v5.md`: T17/T18 wording fail-closed.
