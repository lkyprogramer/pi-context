#!/usr/bin/env python3
"""Aggregate arm-level evidence from local-eval run directories (read-only).

Usage:
  python3 scripts/aggregate_runs.py --artifacts ../../../artifacts/local-eval \
      --runs review-qc-20260910 review-qc-20260911 review-qc-20260911-fold1 \
      --out evidence/run-aggregates.json

Reads manifest.json, episodes.jsonl, requests.jsonl. Only Q* quality cases enter the paired
aggregates; C* capability cells are listed separately. Nothing is extrapolated: sums, counts and
relative changes computed from the recorded usage only. Missing usage is counted as unknown, never 0.
"""
import argparse, json, statistics
from collections import defaultdict
from pathlib import Path


def load_jsonl(path):
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def rel(b, n):
    return None if not n else round((b - n) / n, 4)


def aggregate(run_dir: Path):
    manifest = json.loads((run_dir / "manifest.json").read_text())
    episodes = load_jsonl(run_dir / "episodes.jsonl")
    requests = load_jsonl(run_dir / "requests.jsonl")
    report = json.loads((run_dir / "report.json").read_text()) if (run_dir / "report.json").exists() else {}

    def cell():
        return {
            "episodes": 0, "passed": 0, "failed": 0, "wrongActions": 0, "requests": 0,
            "sumInput": 0, "sumCacheRead": 0, "unknownUsage": 0,
            "nativeCompactions": 0, "folds": 0, "historyReads": 0, "verifiedReads": 0,
            "wallMs": [],
        }

    arms = defaultdict(cell)
    per_case = defaultdict(lambda: defaultdict(cell))
    discordant = []
    by_pair = defaultdict(dict)
    for e in episodes:
        m = e.get("manifest", {})
        cid, arm, rep = m.get("caseId"), m.get("arm"), m.get("rep")
        if not cid or not cid.startswith("Q"):
            continue
        for c in (arms[arm], per_case[cid][arm]):
            c["episodes"] += 1
            o = e.get("oracle") or {}
            if o.get("passed") is True:
                c["passed"] += 1
            elif o.get("passed") is False:
                c["failed"] += 1
            if o.get("protectedIntact") is False or (o.get("outsideEditable") or 0) > 0:
                c["wrongActions"] += 1
            mech = e.get("mechanism") or {}
            for k in ("nativeCompactions", "folds", "historyReads", "verifiedReads"):
                c[k] += mech.get(k) or 0
            if isinstance(e.get("wallMs"), (int, float)):
                c["wallMs"].append(e["wallMs"])
        by_pair[(cid, rep)][arm] = (e.get("oracle") or {}).get("passed")
    for (cid, rep), outcome in sorted(by_pair.items()):
        n, b = outcome.get("native"), outcome.get("balanced")
        if n is True and b is False:
            discordant.append({"caseId": cid, "rep": rep, "kind": "candidate-fail-native-pass"})
        elif n is False and b is True:
            discordant.append({"caseId": cid, "rep": rep, "kind": "candidate-pass-native-fail"})
        elif n is False and b is False:
            discordant.append({"caseId": cid, "rep": rep, "kind": "shared-failure"})
    for r in requests:
        cid, arm = r.get("caseId"), r.get("arm")
        if not cid or not cid.startswith("Q"):
            continue
        u = r.get("usage") or {}
        for c in (arms[arm], per_case[cid][arm]):
            c["requests"] += 1
            if u.get("input") is None or u.get("cacheRead") is None:
                c["unknownUsage"] += 1
                continue
            c["sumInput"] += u["input"]
            c["sumCacheRead"] += u["cacheRead"]

    def finish(c):
        walls = c.pop("wallMs")
        c["wallSumMs"] = int(sum(walls))
        c["wallMedianMs"] = int(statistics.median(walls)) if walls else None
        c["logicalInput"] = c["sumInput"] + c["sumCacheRead"] if c["unknownUsage"] == 0 else None
        return c

    for c in arms.values():
        finish(c)
    for case in per_case.values():
        for c in case.values():
            finish(c)
    n, b = arms.get("native"), arms.get("balanced")
    relative = None
    if n and b and n["unknownUsage"] == 0 and b["unknownUsage"] == 0:
        relative = {
            "freshInput": rel(b["sumInput"], n["sumInput"]),
            "cacheRead": rel(b["sumCacheRead"], n["sumCacheRead"]),
            "logicalInput": rel(b["logicalInput"], n["logicalInput"]),
            "requests": rel(b["requests"], n["requests"]),
            "wallSum": rel(b["wallSumMs"], n["wallSumMs"]),
            "pairedSuccessDelta": round((b["passed"] - n["passed"]) / n["episodes"], 4) if n["episodes"] else None,
        }
    return {
        "runId": manifest.get("runId"),
        "createdAt": manifest.get("createdAt"),
        "git": manifest.get("git"),
        "dirtyDigest": (manifest.get("dirtyDigest") or "")[:12] or None,
        "pluginEntrySha256": (manifest.get("pluginSha256") or "")[:12] or None,
        "distFilesChangedVsPrevious": None,
        "model": manifest.get("model"),
        "window": (manifest.get("plan") or {}).get("window") or manifest.get("plan", {}).get("window"),
        "decision": report.get("decision"),
        "qualityArms": dict(arms),
        "perCase": {k: dict(v) for k, v in per_case.items()},
        "discordantPairs": discordant,
        "relativeChangeBalancedVsNative": relative,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    root = Path(a.artifacts)
    out = {"schemaVersion": 1, "note": "Computed from recorded usage/oracle only; Q* cases; no extrapolation.", "runs": []}
    prev = None
    for run in a.runs:
        agg = aggregate(root / run)
        manifest = json.loads((root / run / "manifest.json").read_text())
        if prev is not None:
            pf, cf = prev.get("distFiles") or {}, manifest.get("distFiles") or {}
            agg["distFilesChangedVsPrevious"] = sorted(k for k in set(pf) | set(cf) if pf.get(k) != cf.get(k))
        prev = manifest
        out["runs"].append(agg)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    for r in out["runs"]:
        print(r["runId"], r["decision"], r["relativeChangeBalancedVsNative"])


if __name__ == "__main__":
    main()
