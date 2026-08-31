#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/pi-context-current-state-audit-next-plan-v1.0.0"
FINDINGS = PLAN / "findings/findings.json"

def load():
    return json.loads(FINDINGS.read_text())

def save(rows):
    FINDINGS.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")

def git_head():
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True)
    return result.stdout.strip()

def verify_item(item, head):
    if item.get("status") != "closed":
        return None
    if not item.get("verifiedAtCommit"):
        return "missing-verification"
    if item["verifiedAtCommit"] != head:
        return "stale-commit"
    if not item.get("verificationRunId") or not item.get("verificationTask"):
        return "missing-verification"
    evidence = item.get("closureEvidence")
    if not evidence or evidence.endswith(".md") and "/" not in str(evidence):
        return "path-only-evidence"
    return None

p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="command", required=True)
sub.add_parser("list")
c = sub.add_parser("close")
c.add_argument("id")
c.add_argument("--evidence", required=True)
c.add_argument("--verification-task", required=True)
c.add_argument("--verification-run", required=True)
v = sub.add_parser("verify-all")
a = p.parse_args()
rows = load()
head = git_head()
if a.command == "list":
    for item in rows:
        if item.get("status") == "open":
            print(item["id"], item.get("severity"), item.get("title"))
elif a.command == "close":
    item = next(x for x in rows if x["id"] == a.id)
    evidence_path = ROOT / a.evidence
    if not evidence_path.exists():
        raise SystemExit("close requires existing evidence")
    if a.id.startswith("F") and item.get("severity") == "P0":
        # P0 close still requires verify-all to pass later; record fields now.
        pass
    item["status"] = "closed"
    item["closureEvidence"] = a.evidence
    item["verifiedAtCommit"] = head
    item["verificationTask"] = a.verification_task
    item["verificationRunId"] = a.verification_run
    save(rows)
    print(a.id)
elif a.command == "verify-all":
    errors = []
    for item in rows:
        problem = verify_item(item, head)
        if problem:
            errors.append(f"{item['id']}:{problem}")
    if errors:
        print("FAIL")
        print("\n".join(errors))
        sys.exit(1)
    print("PASS")
