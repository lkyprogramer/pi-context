from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("taskctl", Path(__file__).with_name("taskctl.py"))
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class TaskCtlTest(unittest.TestCase):
    def test_default_state_contains_every_task(self):
        state = mod.default_state()
        self.assertEqual(set(state["tasks"]), set(mod.task_index()))
        self.assertTrue(all(v["status"] == "pending" for v in state["tasks"].values()))

    def test_b01_is_ready_and_b02_is_not(self):
        state = mod.default_state()
        self.assertTrue(mod.check_ready("B01", state)[0])
        self.assertFalse(mod.check_ready("B02", state)[0])

    def test_dependency_becomes_ready_after_done_with_evidence_and_commit(self):
        state = mod.default_state()
        state["tasks"]["B01"].update(status="done", commit="abc1234", evidenceSha256="0" * 64)
        self.assertTrue(mod.check_ready("B02", state)[0])


if __name__ == "__main__":
    unittest.main()
