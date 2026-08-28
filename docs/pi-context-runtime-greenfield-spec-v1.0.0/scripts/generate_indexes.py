#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAPH_PATH = ROOT / "tasks" / "task-graph.json"
TASK_INDEX_PATH = ROOT / "tasks" / "TASK-INDEX.json"
FILE_INDEX_PATH = ROOT / "FILE-INDEX.md"


def write_task_index() -> None:
    graph = json.loads(GRAPH_PATH.read_text(encoding="utf-8"))
    waves: dict[str, list[str]] = defaultdict(list)
    for task in graph["tasks"]:
        waves[task["wave"]].append(task["id"])
    index = {
        "schemaVersion": graph.get("schemaVersion", 1),
        "project": "pi-context-runtime",
        "taskCount": len(graph["tasks"]),
        "waves": {wave: waves[wave] for wave in sorted(waves)},
        "tasks": graph["tasks"],
    }
    TASK_INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def table(title: str, paths: list[Path]) -> list[str]:
    rows = [f"## {title}", "", "| 文件 | 字节 |", "|---|---:|"]
    for path in sorted(paths):
        rel = path.relative_to(ROOT).as_posix()
        rows.append(f"| [`{rel}`]({rel}) | {path.stat().st_size:,} |")
    rows.append("")
    return rows


def write_file_index() -> None:
    categories: list[tuple[str, list[Path]]] = [
        ("根目录与总览", [ROOT / name for name in ["ARTIFACT-STATS.json", "BUILD-INFO.json", "GLOSSARY.md", "LICENSE-NOTICE.md", "README.md", "VALIDATION.md"]]),
        ("编号规格文档", list(ROOT.glob("[0-9][0-9]-*.md"))),
        ("架构决策 ADR", list((ROOT / "adrs").glob("*.md"))),
        ("AI Agent 开发任务", list((ROOT / "tasks").glob("*.md")) + [GRAPH_PATH, TASK_INDEX_PATH, ROOT / "tasks" / "task-status.template.jsonl"]),
        ("实施计划", list((ROOT / "plans").glob("*.md"))),
        ("Pi Adapter 规格", list((ROOT / "pi-adapter").glob("*.md"))),
        ("Agent 执行 Playbooks", list((ROOT / "agent-playbooks").glob("*.md"))),
        ("JSON Schema", list((ROOT / "schemas").glob("*"))),
        ("配置方案", list((ROOT / "configs").glob("*"))),
        ("机器可读示例", list((ROOT / "examples").glob("*"))),
        ("Mermaid 图源", list((ROOT / "diagrams").glob("*"))),
        ("检查表", list((ROOT / "checklists").glob("*"))),
        ("参考合同与骨架", list((ROOT / "reference").glob("*"))),
        ("兼容性锁", list((ROOT / "compat").glob("*"))),
        ("验证和调度脚本", list((ROOT / "scripts").glob("*"))),
        ("来源快照", [p for p in (ROOT / "sources").rglob("*") if p.is_file()]),
    ]
    lines = [
        "# 文件索引",
        "",
        "本索引覆盖文档包内的设计规格、开发任务、机器可读合同、参考骨架和验证资产。路径均相对于文档包根目录。",
        "",
    ]
    for title, paths in categories:
        existing = [p for p in paths if p.is_file() and p not in {FILE_INDEX_PATH, ROOT / "MANIFEST.sha256"}]
        lines.extend(table(title, existing))
    FILE_INDEX_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    write_task_index()
    write_file_index()
    print(f"generated {TASK_INDEX_PATH.relative_to(ROOT)} and {FILE_INDEX_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
