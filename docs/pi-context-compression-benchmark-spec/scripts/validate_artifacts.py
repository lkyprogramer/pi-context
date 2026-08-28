from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []
checks = 0


def check(cond: bool, msg: str) -> None:
    global checks
    checks += 1
    if not cond:
        errors.append(msg)


def load(path: Path):
    return json.loads(path.read_text("utf-8"))


# JSON parse
for p in ROOT.rglob("*.json"):
    try:
        load(p)
    except Exception as exc:
        errors.append(f"json {p.relative_to(ROOT)}: {exc}")
    checks += 1

# Schema self-validation
schemas: dict[str, dict] = {}
for p in sorted((ROOT / "schemas").glob("*.schema.json")):
    obj = load(p)
    schemas[p.name] = obj
    try:
        jsonschema.Draft202012Validator.check_schema(obj)
    except Exception as exc:
        errors.append(f"schema {p.name}: {exc}")
    checks += 1

# Examples map
mapping = {
    "trace-snapshot.example.json": "trace-snapshot.schema.json",
    "oracle.example.json": "oracle.schema.json",
    "arm-a0.example.json": "arm-manifest.schema.json",
    "arm-a2.example.json": "arm-manifest.schema.json",
    "compression-artifact.example.json": "compression-artifact.schema.json",
    "static-score.example.json": "static-score.schema.json",
    "probe-suite.example.json": "probe-suite.schema.json",
    "probe-result.example.json": "probe-result.schema.json",
    "continuation-scenario.example.json": "continuation-scenario.schema.json",
    "continuation-result.example.json": "continuation-result.schema.json",
    "recall-eval.example.json": "recall-eval.schema.json",
    "cost-metrics.example.json": "cost-metrics.schema.json",
    "llm-judge-record.example.json": "llm-judge-record.schema.json",
    "run-manifest.example.json": "run-manifest.schema.json",
    "benchmark-config.example.json": "benchmark-config.schema.json",
    "benchmark-report.example.json": "benchmark-report.schema.json",
    "gate-decision.example.json": "gate-decision.schema.json",
    "environment-assertion-result.example.json": "environment-assertion-result.schema.json",
}
for ex, sch in mapping.items():
    try:
        jsonschema.validate(load(ROOT / "examples" / ex), schemas[sch])
    except Exception as exc:
        errors.append(f"example {ex} vs {sch}: {exc}")
    checks += 1

# Config validation and semantic checks
for p in sorted((ROOT / "configs").glob("*.json")):
    try:
        obj = load(p)
        jsonschema.validate(obj, schemas["benchmark-config.schema.json"])
        check(obj["replicates"] >= 1, f"config {p.name}: replicates < 1")
        check(obj["bootstrapSamples"] >= 1000, f"config {p.name}: bootstrapSamples too small")
        check(len(set(obj["arms"])) == len(obj["arms"]), f"config {p.name}: duplicate arms")
        if obj["profile"] == "w1-gate":
            check(obj["arms"] == ["A0", "A1", "A2"], "w1-gate arms must be A0/A1/A2")
            check(obj["qualityNonInferiorityMargin"] == 0.03, "w1-gate margin must be 0.03")
        if obj["profile"] == "w2-gate":
            check(obj["arms"] == ["B0", "B1", "B2"], "w2-gate arms must be B0/B1/B2")
            check(obj["qualityNonInferiorityMargin"] == 0.02, "w2-gate margin must be 0.02")
    except Exception as exc:
        errors.append(f"config {p.name}: {exc}")
    checks += 1

# Scenario templates
scenario_schema = schemas["benchmark-scenario.schema.json"]
scenario_paths = sorted((ROOT / "corpus" / "templates").glob("*.scenario.json"))
check(len(scenario_paths) == 12, f"expected 12 scenario templates, got {len(scenario_paths)}")
scenario_ids: set[str] = set()
for p in scenario_paths:
    try:
        obj = load(p)
        jsonschema.validate(obj, scenario_schema)
        check(obj["scenarioId"] not in scenario_ids, f"duplicate scenarioId {obj['scenarioId']}")
        scenario_ids.add(obj["scenarioId"])
        check(len(obj["oracleItems"]) > 0, f"{p.name}: no oracle items")
        check(len(obj["environmentAssertions"]) > 0, f"{p.name}: no environment assertions")
        check(obj["hiddenContinuation"].get("sealed") is True, f"{p.name}: hidden continuation not sealed")
    except Exception as exc:
        errors.append(f"scenario {p.name}: {exc}")
    checks += 1

# Task graph and document completeness
index = load(ROOT / "tasks" / "TASK-INDEX.json")["tasks"]
ids = [x["id"] for x in index]
check(len(ids) == 18, f"expected 18 tasks, got {len(ids)}")
check(len(ids) == len(set(ids)), "duplicate task ids")
known = set(ids)
required_task_sections = [
    "## 1. 开始前检查",
    "## 2. 唯一允许修改的文件",
    "## 3. 输入与输出合同",
    "## 4. 明确非目标",
    "## 5. TDD 执行步骤",
    "### Step 1.1 — 在同一测试文件定义固定 Fixture",
    "## 6. 完成验收",
    "## 7. Reviewer Focus",
]
for task in index:
    tid = task["id"]
    check(all(d in known for d in task["dependsOn"]), f"unknown dependency {tid}")
    matches = list((ROOT / "tasks").glob(tid + "-*.md"))
    check(len(matches) == 1, f"task doc missing/duplicate {tid}")
    if len(matches) == 1:
        text = matches[0].read_text("utf-8")
        for section in required_task_sections:
            check(section in text, f"{tid}: missing section {section}")
        for allowed in task["allowedFiles"]:
            check(f"`{allowed}`" in text, f"{tid}: allowed file absent from doc {allowed}")
        check("```ts" in text, f"{tid}: no TypeScript contract/test block")
        check("RED" in text and "GREEN" in text, f"{tid}: missing red/green workflow")
        check("sourceDigest" in text, f"{tid}: missing evidence digest")
        lowered = text.lower()
        for bad in ("tbd", "todo", "implement later", "fill in details", "similar to task"):
            check(bad not in lowered, f"{tid}: placeholder phrase {bad}")

# Cycle detection
graph = {x["id"]: x["dependsOn"] for x in index}
state: dict[str, int] = {}

def dfs(node: str) -> None:
    if state.get(node) == 1:
        errors.append("cycle at " + node)
        return
    if state.get(node) == 2:
        return
    state[node] = 1
    for dep in graph[node]:
        dfs(dep)
    state[node] = 2

for tid in ids:
    dfs(tid)
checks += len(ids)

# Core protocol invariants
arms_doc = (ROOT / "04-experimental-arms-and-factorial-design.md").read_text("utf-8")
check("W1 Gate 不能声称是在比较两个 compactor" in arms_doc, "W1 non-compactor invariant missing")
check(all(x in arms_doc for x in ("A0", "A1", "A2", "B0", "B1", "B2")), "arm definitions incomplete")
comparison_doc = (ROOT / "30-pi-native-vs-pcr-comparison-protocol.md").read_text("utf-8")
check("Artifact-only" in comparison_doc and "Reader-only" in comparison_doc and "Executor Closed-loop" in comparison_doc, "three comparison views missing")
judge_doc = (ROOT / "14-llm-as-judge-protocol.md").read_text("utf-8")
check("禁止用途" in judge_doc and "唯一 W1/W2 Gate" in judge_doc, "judge boundary missing")
check((ROOT / "reports" / "REPORT-TEMPLATE.md").exists(), "report template missing")

# Markdown links/fences
link_re = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
for p in ROOT.rglob("*.md"):
    text = p.read_text("utf-8")
    check(text.count("```") % 2 == 0, f"unbalanced fence {p.relative_to(ROOT)}")
    for link in link_re.findall(text):
        if link.startswith(("http://", "https://", "#", "mailto:")):
            continue
        raw = link.split("#")[0]
        if not raw:
            continue
        target = (p.parent / raw).resolve()
        check(target.exists(), f"broken link {p.relative_to(ROOT)} -> {link}")

# Reference tests
try:
    env = dict(__import__("os").environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    completed = subprocess.run(
        [sys.executable, "-m", "unittest", "reference.test_reference_scorer", "scripts.test_taskctl"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    check(completed.returncode == 0, "reference tests failed: " + completed.stdout + completed.stderr)
except Exception as exc:
    errors.append(f"reference tests: {exc}")

# Source snapshot consistency
source = load(ROOT / "SOURCE-SNAPSHOT.json")
build = load(ROOT / "BUILD-INFO.json")
check(source["pi"]["mainCommit"] == build["piCommit"], "Pi commit mismatch")
check(source["pi"]["codingAgentVersion"] == build["piCodingAgentVersion"], "Pi version mismatch")

# Manifest verification when present
manifest = ROOT / "MANIFEST.sha256"
if manifest.exists():
    entries = []
    for line in manifest.read_text("utf-8").splitlines():
        if not line.strip():
            continue
        digest, rel = line.split("  ", 1)
        entries.append(rel)
        path = ROOT / rel
        check(path.exists(), f"manifest path missing {rel}")
        if path.exists():
            h = hashlib.sha256(path.read_bytes()).hexdigest()
            check(h == digest, f"manifest hash mismatch {rel}")
    expected = sorted(str(p.relative_to(ROOT)) for p in ROOT.rglob("*") if p.is_file() and p.name != "MANIFEST.sha256")
    check(sorted(entries) == expected, "manifest coverage mismatch")

# No empty files / accidental cache
for p in ROOT.rglob("*"):
    if p.is_file():
        check(p.stat().st_size > 0, f"empty {p.relative_to(ROOT)}")
    if p.is_dir():
        check(p.name != "__pycache__", f"__pycache__ present {p.relative_to(ROOT)}")

if errors:
    print("FAIL", len(errors), "errors /", checks, "checks")
    for e in errors[:200]:
        print("-", e)
    sys.exit(1)

print("PASS:", checks, "checks")
print("files:", sum(1 for p in ROOT.rglob("*") if p.is_file()))
print("tasks:", len(ids), "schemas:", len(schemas), "examples:", len(mapping), "scenarios:", len(scenario_paths))
