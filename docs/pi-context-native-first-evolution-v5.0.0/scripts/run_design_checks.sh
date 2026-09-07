#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_JAVA=false
if [[ "${1:-}" == "--with-java" ]]; then WITH_JAVA=true
elif [[ $# -gt 0 ]]; then echo 'Usage: bash scripts/run_design_checks.sh [--with-java]' >&2; exit 2; fi
export PYTHONDONTWRITEBYTECODE=1
printf '[1/4] Validate design bundle\n'
python3 "$ROOT/scripts/validate_bundle.py"
printf '[2/4] Test reporting utility\n'
python3 "$ROOT/scripts/test_eval_tools.py"
printf '[3/4] Test schemas, DAG and SQLite DDL\n'
python3 "$ROOT/scripts/test_bundle_tools.py"
if "$WITH_JAVA"; then
  printf '[4/4] Calibrate bundled Java oracles (not product tests)\n'
  python3 "$ROOT/scripts/verify_java_fixtures.py"
else
  printf '[4/4] Java oracle calibration NOT RUN; use --with-java\n'
fi
printf 'Design checks complete. No real Pi integration or live model benchmark was performed.\n'
