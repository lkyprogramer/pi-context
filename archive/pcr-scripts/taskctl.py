#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "tasks" / "task-graph.json"
STATUS_TEMPLATE = ROOT / "tasks" / "task-status.template.jsonl"
STATE_DIR = ROOT / ".pcr"
STATUS = STATE_DIR / "task-status.jsonl"
NOTES_REF = "refs/notes/pi-context-runtime-tasks"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def restore_status_from_git_notes(rows: list[dict[str, Any]]) -> int:
    """Restore completed task records from repository-local Git notes when available."""
    if not (ROOT / ".git").exists():
        return 0
    try:
        listing = subprocess.check_output(
            ["git", "notes", f"--ref={NOTES_REF}", "list"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return 0
    states = by_id(rows)
    restored = 0
    for line in listing.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        object_sha = parts[1]
        try:
            raw = subprocess.check_output(
                ["git", "notes", f"--ref={NOTES_REF}", "show", object_sha], cwd=ROOT, text=True
            )
            note = json.loads(raw)
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            continue
        task_id = note.get("taskId")
        if task_id not in states:
            continue
        row = states[task_id]
        row.update(
            status="done",
            commitSha=note.get("commitSha") or object_sha,
            completedAt=note.get("recordedAt"),
            evidenceDir=note.get("evidencePath"),
            blocker=None,
        )
        restored += 1
    return restored


def ensure_local_status() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if not STATUS.exists():
        rows = [json.loads(line) for line in STATUS_TEMPLATE.read_text(encoding="utf-8").splitlines() if line.strip()]
        restore_status_from_git_notes(rows)
        save_status(rows)


def load_graph() -> dict[str, Any]:
    return json.loads(GRAPH.read_text(encoding="utf-8"))


def load_status() -> list[dict[str, Any]]:
    ensure_local_status()
    return [json.loads(line) for line in STATUS.read_text(encoding="utf-8").splitlines() if line.strip()]


def save_status(rows: list[dict[str, Any]]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATUS.with_suffix(".jsonl.tmp")
    tmp.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    os.replace(tmp, STATUS)


def by_id(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {row["taskId"]: row for row in rows}


def graph_task(graph: dict[str, Any], task_id: str) -> dict[str, Any]:
    task = next((item for item in graph["tasks"] if item["id"] == task_id), None)
    if task is None:
        raise KeyError(f"unknown task {task_id}")
    return task


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def check_ready(task_id: str, graph: dict[str, Any], rows: list[dict[str, Any]]) -> tuple[bool, str]:
    task = graph_task(graph, task_id)
    states = by_id(rows)
    row = states.get(task_id)
    if row is None:
        return False, f"{task_id}: missing status"
    missing = [dep for dep in task["dependsOn"] if states.get(dep, {}).get("status") != "done"]
    if missing:
        return False, f"{task_id}: blocked by {', '.join(missing)}"
    status = row["status"]
    if status == "pending":
        return True, f"{task_id}: ready"
    if status == "in-progress":
        return True, f"{task_id}: in-progress owner={row.get('owner') or 'unknown'}"
    if status == "blocked" and not row.get("blocker"):
        return True, f"{task_id}: ready (blocker cleared)"
    return False, f"{task_id}: not ready ({status})"


def task_allowed_files(task: dict[str, Any]) -> list[str]:
    path = ROOT / task["taskFile"]
    text = path.read_text(encoding="utf-8")
    marker = "### 唯一允许写入集合"
    if marker not in text:
        raise AssertionError(f"{task['id']}: allowed-file section missing")
    section = text.split(marker, 1)[1].split("\n## ", 1)[0]
    files = [match.group(1).strip() for match in re.finditer(r"^- (.+)$", section, re.M)]
    if not files:
        raise AssertionError(f"{task['id']}: allowed-file section empty")
    return files


def parallel_ready_tasks(graph: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Greedily select a deterministic set of ready tasks with disjoint write sets."""
    selected: list[dict[str, Any]] = []
    occupied: set[str] = set()
    states = by_id(rows)
    for task in graph["tasks"]:
        task_id = task["id"]
        ok, _message = check_ready(task_id, graph, rows)
        if not ok or states[task_id]["status"] == "in-progress":
            continue
        allowed = set(task_allowed_files(task))
        if allowed & occupied:
            continue
        selected.append({"taskId": task_id, "allowedFiles": sorted(allowed)})
        occupied.update(allowed)
    return selected


def normalize_relative(path_text: str) -> str:
    path_text = path_text.replace("\\", "/")
    path = Path(path_text)
    if path.is_absolute() or ".." in path.parts:
        raise AssertionError(f"unsafe artifact path: {path_text}")
    resolved = (ROOT / path).resolve()
    resolved.relative_to(ROOT.resolve())
    return path.as_posix()


def compute_source_digest(allowed_files: list[str], evidence_rel: str) -> str:
    digest = hashlib.sha256()
    for rel in sorted(normalize_relative(item) for item in allowed_files if item != evidence_rel):
        path = ROOT / rel
        if not path.is_file():
            raise AssertionError(f"missing allowed evidence input: {rel}")
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
        digest.update(b"\n")
    return digest.hexdigest()


def evidence_path(task_id: str) -> Path:
    return ROOT / "artifacts" / "task-evidence" / f"{task_id}.json"


def current_changed_paths() -> set[str]:
    output = subprocess.check_output(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=ROOT, text=True
    )
    changed: set[str] = set()
    for line in output.splitlines():
        raw = line[3:]
        if " -> " in raw:
            raw = raw.split(" -> ", 1)[1]
        rel = raw.strip('"').replace("\\", "/")
        if rel.startswith(".pcr/"):
            continue
        changed.add(rel)
    return changed


def seal_evidence(task_id: str, graph: dict[str, Any]) -> None:
    task = graph_task(graph, task_id)
    path = evidence_path(task_id)
    if not path.is_file():
        raise AssertionError(f"missing {path.relative_to(ROOT)}")
    doc = json.loads(path.read_text(encoding="utf-8"))
    allowed = task_allowed_files(task)
    expected_evidence = path.relative_to(ROOT).as_posix()
    if expected_evidence not in allowed:
        raise AssertionError(f"{task_id}: task allowed files omit {expected_evidence}")
    if set(doc.get("allowedFiles") or []) != set(allowed):
        raise AssertionError(f"{task_id}: evidence allowedFiles differ from task contract")
    doc["sourceDigest"] = compute_source_digest(allowed, expected_evidence)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def verify_evidence(task_id: str, graph: dict[str, Any], *, check_worktree: bool = True) -> dict[str, Any]:
    task = graph_task(graph, task_id)
    path = evidence_path(task_id)
    if not path.is_file():
        raise AssertionError(f"missing {path.relative_to(ROOT)}")
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("taskId") != task_id or doc.get("status") != "done":
        raise AssertionError("evidence taskId/status mismatch")
    acceptance = doc.get("acceptance")
    if not isinstance(acceptance, dict) or not acceptance or any(value is not True for value in acceptance.values()):
        raise AssertionError("every acceptance field must be true")
    allowed = task_allowed_files(task)
    if set(doc.get("allowedFiles") or []) != set(allowed):
        raise AssertionError("evidence allowedFiles differ from task contract")
    evidence_rel = path.relative_to(ROOT).as_posix()
    for field in ("redLog", "greenLog", "fullGateLog"):
        rel = normalize_relative(str(doc.get(field, "")))
        if rel not in allowed:
            raise AssertionError(f"{field} is outside task allowed files: {rel}")
        log_path = ROOT / rel
        if not log_path.is_file() or log_path.stat().st_size == 0:
            raise AssertionError(f"{field} is missing or empty: {rel}")
    expected_digest = compute_source_digest(allowed, evidence_rel)
    if doc.get("sourceDigest") != expected_digest:
        raise AssertionError("sourceDigest mismatch; rerun seal-evidence after final changes")
    if check_worktree:
        changed = current_changed_paths()
        unexpected = sorted(changed - set(allowed))
        if unexpected:
            raise AssertionError(f"changed paths outside task contract: {unexpected}")
    return doc


def add_git_note(task_id: str, sha: str, doc: dict[str, Any]) -> None:
    note = json.dumps(
        {
            "taskId": task_id,
            "commitSha": sha,
            "evidencePath": evidence_path(task_id).relative_to(ROOT).as_posix(),
            "sourceDigest": doc["sourceDigest"],
            "recordedAt": now(),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    subprocess.check_call(["git", "notes", f"--ref={NOTES_REF}", "add", "-f", "-m", note, sha], cwd=ROOT)


def main() -> int:
    parser = argparse.ArgumentParser(description="Local autonomous task state and evidence controller")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    sub.add_parser("next")
    parallel = sub.add_parser("parallel-ready")
    parallel.add_argument("--json", action="store_true", dest="as_json")
    ready = sub.add_parser("check-ready")
    ready.add_argument("task")
    claim = sub.add_parser("claim")
    claim.add_argument("task")
    claim.add_argument("--owner", required=True)
    block = sub.add_parser("block")
    block.add_argument("task")
    block.add_argument("--reason", required=True)
    unblock = sub.add_parser("unblock")
    unblock.add_argument("task")
    seal = sub.add_parser("seal-evidence")
    seal.add_argument("task")
    verify = sub.add_parser("verify-evidence")
    verify.add_argument("task")
    record = sub.add_parser("record-commit")
    record.add_argument("task")
    record.add_argument("ref", nargs="?", default="HEAD")
    status = sub.add_parser("status")
    status.add_argument("task", nargs="?")
    args = parser.parse_args()

    graph = load_graph()
    rows = load_status()
    states = by_id(rows)

    if args.cmd == "init":
        restored = restore_status_from_git_notes(rows)
        if restored:
            save_status(rows)
        print(
            f"initialized {STATUS.relative_to(ROOT)} from {STATUS_TEMPLATE.relative_to(ROOT)}; "
            f"restored={restored}"
        )
        return 0
    if args.cmd == "next":
        for task in graph["tasks"]:
            ok, message = check_ready(task["id"], graph, rows)
            if ok and states[task["id"]]["status"] != "in-progress":
                print(message)
                return 0
        print("no ready task")
        return 1
    if args.cmd == "parallel-ready":
        selected = parallel_ready_tasks(graph, rows)
        if args.as_json:
            print(json.dumps(selected, ensure_ascii=False, indent=2))
        else:
            print(" ".join(item["taskId"] for item in selected) if selected else "no parallel-ready task")
        return 0 if selected else 1
    if args.cmd == "check-ready":
        ok, message = check_ready(args.task, graph, rows)
        print(message)
        return 0 if ok else 1
    if args.cmd == "claim":
        ok, message = check_ready(args.task, graph, rows)
        if not ok:
            print(message, file=sys.stderr)
            return 1
        row = states[args.task]
        if row["status"] == "in-progress":
            if row.get("owner") != args.owner:
                print(f"{args.task}: owned by {row.get('owner')}", file=sys.stderr)
                return 1
            print(f"{args.task}: already in-progress owner={args.owner}")
            return 0
        row.update(status="in-progress", owner=args.owner, startedAt=now(), blocker=None)
        save_status(rows)
        print(f"{args.task}: in-progress owner={args.owner}")
        return 0
    if args.cmd == "block":
        row = states[args.task]
        row.update(status="blocked", blocker=args.reason)
        save_status(rows)
        print(f"{args.task}: blocked")
        return 0
    if args.cmd == "unblock":
        row = states[args.task]
        row.update(status="pending", owner=None, blocker=None)
        save_status(rows)
        print(f"{args.task}: pending")
        return 0
    if args.cmd == "seal-evidence":
        seal_evidence(args.task, graph)
        print(f"{args.task}: evidence sealed")
        return 0
    if args.cmd == "verify-evidence":
        verify_evidence(args.task, graph)
        print(f"{args.task}: evidence valid")
        return 0
    if args.cmd == "record-commit":
        doc = verify_evidence(args.task, graph, check_worktree=False)
        sha = git("rev-parse", args.ref)
        evidence_rel = evidence_path(args.task).relative_to(ROOT).as_posix()
        committed = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", sha], cwd=ROOT, text=True).splitlines()
        if evidence_rel not in committed:
            raise AssertionError(f"commit {sha} does not contain {evidence_rel}")
        add_git_note(args.task, sha, doc)
        row = states[args.task]
        row.update(status="done", commitSha=sha, completedAt=now(), evidenceDir=evidence_rel)
        save_status(rows)
        print(f"{args.task}: done {sha}")
        return 0
    if args.cmd == "status":
        if args.task:
            print(json.dumps(states[args.task], ensure_ascii=False, indent=2))
        else:
            print("\n".join(f"{row['taskId']} {row['status']}" for row in rows))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
