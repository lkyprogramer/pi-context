# AI Agent Start Here

1. Read `00-executive-summary.md`, `11-rearchitecture-decision.md`, `12-target-architecture.md`.
2. Run `python3 scripts/validate_artifacts.py`.
3. Initialize state: `cp tasks/task-status.template.json .pcr/task-status.json`.
4. Get work: `python3 scripts/taskctl.py next`.
5. Open the matching Task document and execute exactly its checklist.
6. Never skip RED, locked corpus or full gate.
7. Use `findings/findings.json` to understand the defect being closed.
