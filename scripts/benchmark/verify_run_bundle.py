#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SHA256 = re.compile(r"^[a-f0-9]{64}$")
REQUIRED = (
    "sessionJsonl",
    "storeSnapshotSha256",
    "workspaceManifestSha256",
    "configIdentity",
    "modelIdentity",
    "providerIdentity",
    "rawReport",
    "decision",
)


def fail(code: str) -> None:
    raise SystemExit(code)


def verify(path: Path) -> None:
    payload = json.loads(path.read_text())
    for key in REQUIRED:
        if key not in payload or payload[key] in (None, "", []):
            fail(f"PCR_BUNDLE_RAW_MISSING:{key}")
    jsonl = payload["sessionJsonl"]
    if not isinstance(jsonl, str) or len(jsonl) <= 400:
        fail("PCR_BUNDLE_PREVIEW_ONLY")
    for key in ("storeSnapshotSha256", "workspaceManifestSha256"):
        if not SHA256.match(str(payload[key])):
            fail(f"PCR_BUNDLE_RAW_MISSING:{key}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_run_bundle.py <bundle.json>")
    verify(Path(sys.argv[1]))
    print("ok")
