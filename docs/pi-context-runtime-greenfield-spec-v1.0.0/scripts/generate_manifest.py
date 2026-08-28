#!/usr/bin/env python3
from __future__ import annotations
import hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'MANIFEST.sha256'
lines=[]
for path in sorted(p for p in ROOT.rglob('*') if p.is_file() and p != OUT):
    lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(ROOT).as_posix()}")
OUT.write_text('\n'.join(lines)+'\n', encoding='utf-8')
print(f'WROTE: {OUT.name} ({len(lines)} entries)')
