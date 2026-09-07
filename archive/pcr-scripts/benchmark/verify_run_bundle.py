#!/usr/bin/env python3
from __future__ import annotations

import json
import hashlib
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


def verify_payload(payload: dict) -> None:
    for key in REQUIRED:
        if key not in payload or payload[key] in (None, "", []):
            fail(f"PCR_BUNDLE_RAW_MISSING:{key}")
    jsonl = payload["sessionJsonl"]
    if not isinstance(jsonl, str) or len(jsonl) <= 400:
        fail("PCR_BUNDLE_PREVIEW_ONLY")
    for key in ("storeSnapshotSha256", "workspaceManifestSha256"):
        if not SHA256.match(str(payload[key])):
            fail(f"PCR_BUNDLE_RAW_MISSING:{key}")


def canonical_json(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def verify_hashed_bundle(bundle_path: Path, manifest_path: Path) -> None:
    raw = bundle_path.read_bytes()
    payload = json.loads(raw)
    if not isinstance(payload, dict) or "bundle" not in payload or "decision" not in payload:
        fail("PCR_BUNDLE_RAW_MISSING:bundle")
    manifest = json.loads(manifest_path.read_text())
    byte_hash = hashlib.sha256(raw).hexdigest()
    canonical_hash = hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
    if manifest.get("artifactBytesSha256") != byte_hash:
        fail("PCR_BUNDLE_TAMPERED:artifactBytesSha256")
    if manifest.get("canonicalJsonSha256") != canonical_hash:
        fail("PCR_BUNDLE_TAMPERED:canonicalJsonSha256")


def verify_report_manifest(report_path: Path, manifest_path: Path) -> None:
    raw = report_path.read_bytes()
    report = json.loads(raw)
    if not isinstance(report, dict):
        fail("PCR_PUBLICATION_RUN_MISSING")
    manifest = json.loads(manifest_path.read_text())
    byte_hash = hashlib.sha256(raw).hexdigest()
    canonical_hash = hashlib.sha256(canonical_json(report).encode("utf-8")).hexdigest()
    if manifest.get("artifactBytesSha256") != byte_hash:
        fail("PCR_PUBLICATION_HASH_MISMATCH:artifactBytesSha256")
    if manifest.get("canonicalJsonSha256") != canonical_hash:
        fail("PCR_PUBLICATION_HASH_MISMATCH:canonicalJsonSha256")
    if manifest.get("files", {}).get("report.json") != byte_hash:
        fail("PCR_PUBLICATION_REPORT_HASH_MISMATCH")


def verify_arm_dir(arm_dir: Path) -> None:
    session = arm_dir / "session.jsonl"
    if not session.is_file():
        fail(f"PCR_BUNDLE_RAW_MISSING:sessionJsonl:{arm_dir.name}")
    failed = (arm_dir / "FAILED").is_file()
    if not failed and session.stat().st_size <= 400:
        fail("PCR_BUNDLE_PREVIEW_ONLY")
    for name in ("workspace.sha256", "store.sha256"):
        digest = arm_dir / name
        if not digest.is_file() or not SHA256.match(digest.read_text().strip()):
            fail(f"PCR_BUNDLE_RAW_MISSING:{name}:{arm_dir.name}")
    if failed and not (arm_dir / "raw.json").is_file():
        fail(f"PCR_BUNDLE_FAILED_SAMPLE_DELETED:{arm_dir.name}")


def verify(path: Path) -> None:
    if path.is_dir():
        bundle = path / "bundle.json"
        manifest = path / "manifest.json"
        raw = path / "raw.json"
        arms = path / "arms"
        if bundle.is_file():
            if manifest.is_file():
                verify_hashed_bundle(bundle, manifest)
                return
            verify_payload(json.loads(bundle.read_text()))
            return
        report = path / "report.json"
        run_manifest = path / "run-manifest.json"
        if report.is_file() or run_manifest.is_file():
            if not report.is_file() or not run_manifest.is_file():
                fail("PCR_PUBLICATION_RUN_MISSING")
            verify_report_manifest(report, run_manifest)
            # Continue to verify retained arm evidence when present.
        if raw.is_file():
            verify_payload(json.loads(raw.read_text()))
            return
        if report.is_file() and not arms.is_dir() and not (path / "pairs").is_dir():
            return
        if arms.is_dir():
            children = [child for child in arms.iterdir() if child.is_dir()]
            if not children:
                fail("PCR_BUNDLE_RAW_MISSING:arms")
            for child in children:
                verify_arm_dir(child)
            return
        pairs = path / "pairs"
        if pairs.is_dir():
            found = False
            for pair in pairs.iterdir():
                pair_arms = pair / "arms"
                if not pair_arms.is_dir():
                    continue
                for child in pair_arms.iterdir():
                    if child.is_dir():
                        verify_arm_dir(child)
                        found = True
            if not found:
                fail("PCR_BUNDLE_RAW_MISSING:arms")
            return
        fail("PCR_BUNDLE_RAW_MISSING:bundle")
    verify_payload(json.loads(path.read_text()))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_run_bundle.py <bundle.json|run-dir>")
    verify(Path(sys.argv[1]))
    print("ok")
