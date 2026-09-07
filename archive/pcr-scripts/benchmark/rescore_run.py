#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_run_bundle import verify  # noqa: E402


def recount(session_jsonl: str) -> dict[str, int]:
    return {
        "bytes": len(session_jsonl),
        "compaction": session_jsonl.count('"type":"compaction"'),
        "toolResult": session_jsonl.count('"role":"toolResult"') + session_jsonl.count('"role":"tool-result"'),
        "assistant": session_jsonl.count('"role":"assistant"'),
    }


def rescore(path: Path) -> None:
    arms_dir = path / "arms" if path.is_dir() else None
    if arms_dir and arms_dir.is_dir():
        verify(path)
        arms = {}
        for child in sorted(p for p in arms_dir.iterdir() if p.is_dir()):
            session = child / "session.jsonl"
            arms[child.name] = recount(session.read_text() if session.is_file() else "")
        print(json.dumps({"ok": True, "publicationClaim": False, "rescoreFrom": "session-jsonl", "arms": arms}, sort_keys=True))
        return
    target = path / "bundle.json" if path.is_dir() else path
    verify(target if target.is_file() else path)
    payload = json.loads((target if target.is_file() else path).read_text())
    jsonl = str(payload.get("sessionJsonl") or "")
    print(json.dumps({
        "ok": True,
        "publicationClaim": False,
        "rescoreFrom": "session-jsonl",
        "arms": {"bundle": recount(jsonl)},
    }, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: rescore_run.py <bundle.json|run-dir>")
    rescore(Path(sys.argv[1]))
