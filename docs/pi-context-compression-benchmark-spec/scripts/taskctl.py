#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "tasks" / "TASK-INDEX.json"
STATE_DIR = ROOT / ".benchmark"
STATE = STATE_DIR / "task-status.json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", "utf-8")
    os.replace(tmp, path)


def task_index() -> dict[str, dict[str, Any]]:
    data = load_json(INDEX)
    return {t["id"]: t for t in data["tasks"]}


def default_state() -> dict[str, Any]:
    return {
        "version": "1.0.0",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "tasks": {
            tid: {"status": "pending", "owner": None, "commit": None, "evidenceSha256": None}
            for tid in task_index()
        },
    }


def load_state(create: bool = True) -> dict[str, Any]:
    if not STATE.exists():
        if not create:
            raise SystemExit("task state is not initialized; run taskctl.py init")
        write_json_atomic(STATE, default_state())
    state = load_json(STATE)
    idx = task_index()
    for tid in idx:
        state["tasks"].setdefault(tid, {"status": "pending", "owner": None, "commit": None, "evidenceSha256": None})
    return state


def save_state(state: dict[str, Any]) -> None:
    state["updatedAt"] = datetime.now(timezone.utc).isoformat()
    write_json_atomic(STATE, state)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git_clean() -> bool:
    try:
        out = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL)
        return out.strip() == ""
    except Exception:
        return True


def check_ready(tid: str, state: dict[str, Any]) -> tuple[bool, list[str]]:
    idx = task_index()
    if tid not in idx:
        return False, [f"unknown task {tid}"]
    errors: list[str] = []
    entry = state["tasks"][tid]
    if entry["status"] == "done":
        errors.append(f"{tid} is already done")
    for dep in idx[tid]["dependsOn"]:
        d = state["tasks"][dep]
        if d["status"] != "done" or not d.get("commit") or not d.get("evidenceSha256"):
            errors.append(f"dependency {dep} is not sealed and committed")
    return not errors, errors


def evidence_path(tid: str) -> Path:
    return ROOT / "artifacts" / "task-evidence" / f"{tid}.json"


def validate_evidence(tid: str) -> tuple[dict[str, Any], str]:
    p = evidence_path(tid)
    if not p.exists():
        raise SystemExit(f"missing evidence file: {p.relative_to(ROOT)}")
    data = load_json(p)
    required = {"taskId", "allowedFiles", "sourceDigest", "redLog", "greenLog", "negativeLog", "fullGateLog", "testsPassed", "typecheckPassed", "scopePassed"}
    missing = sorted(required - data.keys())
    if missing:
        raise SystemExit(f"evidence missing keys: {missing}")
    if data["taskId"] != tid:
        raise SystemExit("evidence taskId mismatch")
    for key in ("redLog", "greenLog", "negativeLog", "fullGateLog"):
        log = ROOT / data[key]
        if not log.exists() or log.stat().st_size == 0:
            raise SystemExit(f"missing/empty evidence log: {data[key]}")
    if not all(data[k] is True for k in ("testsPassed", "typecheckPassed", "scopePassed")):
        raise SystemExit("evidence pass flags are not all true")
    return data, sha256_file(p)


def cmd_init(_: argparse.Namespace) -> None:
    write_json_atomic(STATE, default_state())
    print(STATE.relative_to(ROOT))


def cmd_next(_: argparse.Namespace) -> None:
    state = load_state()
    for tid in task_index():
        ok, _ = check_ready(tid, state)
        if ok and state["tasks"][tid]["status"] == "pending":
            print(tid)
            return
    print("none")


def cmd_check_ready(args: argparse.Namespace) -> None:
    state = load_state()
    ok, errors = check_ready(args.task, state)
    if not ok:
        for e in errors:
            print(e, file=sys.stderr)
        raise SystemExit(1)
    print(f"{args.task}: ready")


def cmd_claim(args: argparse.Namespace) -> None:
    state = load_state()
    ok, errors = check_ready(args.task, state)
    if not ok:
        raise SystemExit("; ".join(errors))
    entry = state["tasks"][args.task]
    if entry["status"] == "claimed" and entry["owner"] != args.owner:
        raise SystemExit(f"{args.task} is claimed by {entry['owner']}")
    entry["status"] = "claimed"
    entry["owner"] = args.owner
    save_state(state)
    print(f"{args.task}: claimed by {args.owner}")


def cmd_seal(args: argparse.Namespace) -> None:
    state = load_state()
    data, digest = validate_evidence(args.task)
    idx = task_index()[args.task]
    if sorted(data["allowedFiles"]) != sorted(idx["allowedFiles"]):
        raise SystemExit("evidence allowedFiles do not match TASK-INDEX.json")
    state["tasks"][args.task]["evidenceSha256"] = digest
    state["tasks"][args.task]["status"] = "sealed"
    save_state(state)
    print(digest)


def cmd_verify(args: argparse.Namespace) -> None:
    state = load_state()
    _, digest = validate_evidence(args.task)
    recorded = state["tasks"][args.task].get("evidenceSha256")
    if recorded != digest:
        raise SystemExit(f"evidence digest mismatch: recorded={recorded}, actual={digest}")
    print(f"{args.task}: evidence verified")


def cmd_record_commit(args: argparse.Namespace) -> None:
    state = load_state()
    entry = state["tasks"].get(args.task)
    if not entry:
        raise SystemExit(f"unknown task {args.task}")
    if entry["status"] != "sealed" or not entry.get("evidenceSha256"):
        raise SystemExit("seal and verify evidence before recording commit")
    commit = args.commit
    try:
        commit = subprocess.check_output(["git", "rev-parse", args.commit], cwd=ROOT, text=True).strip()
    except Exception:
        if len(commit) < 7:
            raise SystemExit("commit must be a Git revision or full-enough immutable identifier")
    entry["commit"] = commit
    entry["status"] = "done"
    save_state(state)
    try:
        note = json.dumps({"taskId": args.task, "evidenceSha256": entry["evidenceSha256"]}, sort_keys=True)
        subprocess.run(["git", "notes", "--ref=pi-context-benchmark-tasks", "add", "-f", "-m", note, commit], cwd=ROOT, check=False)
    except Exception:
        pass
    print(f"{args.task}: done at {commit}")


def cmd_status(_: argparse.Namespace) -> None:
    state = load_state()
    for tid, task in task_index().items():
        s = state["tasks"][tid]
        print(f"{tid}\t{s['status']}\towner={s.get('owner') or '-'}\tcommit={s.get('commit') or '-'}\t{task['title']}")


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init").set_defaults(fn=cmd_init)
    sub.add_parser("next").set_defaults(fn=cmd_next)
    c = sub.add_parser("check-ready"); c.add_argument("task"); c.set_defaults(fn=cmd_check_ready)
    c = sub.add_parser("claim"); c.add_argument("task"); c.add_argument("--owner", required=True); c.set_defaults(fn=cmd_claim)
    c = sub.add_parser("seal-evidence"); c.add_argument("task"); c.set_defaults(fn=cmd_seal)
    c = sub.add_parser("verify-evidence"); c.add_argument("task"); c.set_defaults(fn=cmd_verify)
    c = sub.add_parser("record-commit"); c.add_argument("task"); c.add_argument("commit"); c.set_defaults(fn=cmd_record_commit)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
