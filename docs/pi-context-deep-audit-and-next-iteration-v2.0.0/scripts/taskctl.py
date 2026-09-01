#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
repo = root.parents[1] if (root.parents[1] / ".git").exists() else root
index = {x["id"]: x for x in json.loads((root / "tasks/TASK-INDEX.json").read_text())}
state_path = root / ".task-state.json"
SCHEMA_VERSION = 2
COMMIT_RE = re.compile(r"^[a-f0-9]{40}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
REQUIRED = [
    "schemaVersion",
    "taskId",
    "status",
    "currentHead",
    "allowedDiffSha256",
    "sourceDigest",
    "red",
    "green",
    "fullGate",
    "runBundleHashes",
    "acceptanceAssertions",
    "findingsClosed",
    "dirty",
]


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load() -> dict:
    if state_path.exists():
        return json.loads(state_path.read_text())
    return {k: {"status": "pending", "owner": None} for k in index}


def save(s: dict) -> None:
    state_path.write_text(json.dumps(s, indent=2) + "\n")


def fail(code: str) -> None:
    raise SystemExit(code)


def evidence_dir(tid: str) -> Path:
    return root / "artifacts" / "task-evidence" / tid


def verify_run(phase: str, payload: dict, log_path: Path) -> None:
    if not isinstance(payload, dict):
        fail(f"evidence-invalid:{phase}")
    for key in ("command", "exitCode", "logSha256"):
        if key not in payload:
            fail(f"evidence-missing:{phase}.{key}")
    if not isinstance(payload["command"], str) or not payload["command"].strip():
        fail(f"evidence-invalid:{phase}.command")
    if not isinstance(payload["exitCode"], int):
        fail(f"evidence-invalid:{phase}.exitCode")
    if not SHA256_RE.match(str(payload["logSha256"])):
        fail(f"evidence-invalid:{phase}.logSha256")
    if not log_path.is_file():
        fail(f"missing-log:{phase}")
    if sha(log_path) != payload["logSha256"]:
        fail(f"log-hash-mismatch:{phase}")
    if phase == "red" and payload["exitCode"] == 0:
        fail("red-did-not-fail")
    if phase != "red" and payload["exitCode"] != 0:
        fail(f"{phase}-failed")


def verify_evidence(tid: str) -> dict:
    p = evidence_dir(tid) / "evidence.json"
    if not p.exists():
        fail("missing-evidence")
    try:
        e = json.loads(p.read_text())
    except json.JSONDecodeError:
        fail("evidence-invalid-json")
    if not isinstance(e, dict) or e == {}:
        fail("empty-evidence")
    for k in REQUIRED:
        if k not in e:
            fail(f"evidence-missing:{k}")
    if e["schemaVersion"] != SCHEMA_VERSION or e["taskId"] != tid or e["status"] != "done" or e["dirty"] is not False:
        fail("evidence-invalid")
    if not COMMIT_RE.match(str(e["currentHead"])):
        fail("evidence-invalid:currentHead")
    if not SHA256_RE.match(str(e["allowedDiffSha256"])):
        fail("evidence-invalid:allowedDiffSha256")
    if not SHA256_RE.match(str(e.get("sourceDigest", ""))):
        fail("evidence-invalid:sourceDigest")
    head = git("rev-parse", "HEAD")
    if e["currentHead"] != head:
        fail("stale-head")
    if git("status", "--porcelain"):
        fail("dirty-tree")
    verify_run("red", e["red"], evidence_dir(tid) / "red.log")
    verify_run("green", e["green"], evidence_dir(tid) / "green.log")
    verify_run("fullGate", e["fullGate"], evidence_dir(tid) / "full-gate.log")
    assertions = e["acceptanceAssertions"]
    if not isinstance(assertions, list) or not assertions or not all(
        isinstance(x, dict) and x.get("ok") is True and x.get("id") and x.get("evidence") for x in assertions
    ):
        fail("acceptance-failed")
    patterns = index[tid].get("allowedFiles") or []
    tracked = git("ls-files").splitlines()

    def allowed(path: str) -> bool:
        return any(fnmatch.fnmatch(path, pat) for pat in patterns)

    source = hashlib.sha256()
    for path in sorted(p for p in tracked if allowed(p)):
        source.update(path.encode())
        source.update(b"\0")
        source.update((repo / path).read_bytes())
    if source.hexdigest() != e["sourceDigest"]:
        fail("source-digest-mismatch")
    try:
        parent_files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
    except subprocess.CalledProcessError:
        parent_files = ""
    changed = [n for n in parent_files.splitlines() if n and allowed(n)]
    actual_diff = hashlib.sha256("\n".join(changed).encode()).hexdigest()
    if actual_diff != e["allowedDiffSha256"]:
        fail("allowed-diff-mismatch")
    live_or_release = int(tid[1:]) >= 21
    hashes = e.get("runBundleHashes")
    if not isinstance(hashes, list):
        fail("evidence-invalid:runBundleHashes")
    if live_or_release and not hashes:
        fail("missing-run-bundle-hash")
    for digest in hashes:
        if not SHA256_RE.match(str(digest)):
            fail("evidence-invalid:runBundleHashes")
    findings = e.get("findingsClosed")
    if not isinstance(findings, list):
        fail("evidence-invalid:findingsClosed")
    known = {item["id"] for item in json.loads((root / "findings/findings.json").read_text())}
    for fid in findings:
        if fid not in known:
            fail(f"unknown-finding:{fid}")
    return e


def reconcile(matrix_path: Path) -> dict:
    matrix = json.loads(matrix_path.read_text())
    v1_state_path = repo / "docs/pi-context-current-state-audit-next-plan-v1.0.0/.task-state.json"
    current = json.loads(v1_state_path.read_text()) if v1_state_path.exists() else {}
    must_reopen = {"A43", "A44", "A45", "A48"}
    out: dict[str, dict] = {}
    for row in matrix:
        tid = row["taskId"]
        verdict = row.get("auditVerdict")
        declared = row.get("declaredStatus")
        if tid in must_reopen or verdict == "not-met":
            status = "reopened"
        elif verdict == "pending":
            status = "pending"
        elif verdict in {"partial", "verified-component-not-integrated"}:
            status = "partial"
        elif verdict in {"verified", "verified-component"}:
            status = "verified"
        else:
            status = "reopened"
        prev = current.get(tid, {})
        out[tid] = {
            "status": status,
            "declaredStatus": declared,
            "auditVerdict": verdict,
            "reason": row.get("reason"),
            "owner": prev.get("owner"),
        }
    for tid in must_reopen:
        if out.get(tid, {}).get("status") != "reopened":
            fail(f"reconcile-did-not-reopen:{tid}")
    reports = repo / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    findings_dir = repo / "findings"
    findings_dir.mkdir(parents=True, exist_ok=True)
    (findings_dir / "previous-task-reconcile.json").write_text(json.dumps(out, indent=2) + "\n")
    (reports / "previous-task-status.json").write_text(json.dumps(out, indent=2) + "\n")
    v1_state_path.parent.mkdir(parents=True, exist_ok=True)
    v1_state_path.write_text(json.dumps(out, indent=2) + "\n")
    return out


p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="cmd", required=True)
sub.add_parser("init")
sub.add_parser("next")
sub.add_parser("verify-state")
c = sub.add_parser("claim")
c.add_argument("task")
c.add_argument("--owner", required=True)
d = sub.add_parser("done")
d.add_argument("task")
d.add_argument("--owner", required=True)
v = sub.add_parser("verify")
v.add_argument("task")
v.add_argument("--owner")
r = sub.add_parser("reconcile")
r.add_argument("--matrix", required=True)
a = p.parse_args()
s = load()
if a.cmd == "init":
    save(s)
    print(state_path)
elif a.cmd == "next":
    ready = [
        tid
        for tid, t in index.items()
        if s[tid]["status"] == "pending" and all(s[x]["status"] == "done" for x in t["dependsOn"])
    ]
    print("\n".join(ready) if ready else "none")
elif a.cmd == "claim":
    t = index[a.task]
    if s[a.task]["status"] != "pending" or not all(s[x]["status"] == "done" for x in t["dependsOn"]):
        fail("not-ready")
    s[a.task] = {"status": "claimed", "owner": a.owner}
    save(s)
    print(a.task)
elif a.cmd == "verify-state":
    dirty = git("status", "--porcelain")
    print(json.dumps({"head": git("rev-parse", "HEAD"), "dirty": bool(dirty)}, indent=2))
    if dirty:
        fail("dirty-tree")
elif a.cmd == "reconcile":
    result = reconcile(Path(a.matrix))
    print(json.dumps({k: v["status"] for k, v in result.items() if k in {"A43", "A44", "A45", "A48"}}, indent=2))
elif a.cmd in ("verify", "done"):
    if a.cmd == "done" or a.owner:
        if s[a.task].get("owner") != a.owner:
            fail("owner-mismatch")
    verify_evidence(a.task)
    if a.cmd == "done":
        s[a.task] = {"status": "done", "owner": a.owner}
        save(s)
    print(a.task)
