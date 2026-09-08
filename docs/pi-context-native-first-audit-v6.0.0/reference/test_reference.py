import importlib.util
import json
from pathlib import Path
import unittest
from utf8_reference import prefix
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("recompute", ROOT / "scripts/recompute.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RecomputeTests(unittest.TestCase):
    def setUp(self):
        self.rows = json.loads((ROOT / "evidence/pairs-numeric.json").read_text())
    def test_eight_tasks_one_repetition(self):
        r=module.recompute(self.rows)
        self.assertEqual(r["unique_tasks"],8)
        self.assertEqual(r["repetition_labels"],[0])
    def test_j05_not_quality_pool(self):
        r=module.recompute(self.rows)
        self.assertEqual(r["ordinary_without_J05"]["n"],7)
        self.assertEqual(r["J05_capability_only"]["n"],1)
    def test_exact_recorded_sums(self):
        r=module.recompute(self.rows)["all8_as_reported"]["recorded_token_proxy"]
        self.assertEqual(r["baseline_sum"],66222)
        self.assertEqual(r["candidate_sum"],148897)
    def test_ordinary_sum_and_paired_median_differ(self):
        r=module.recompute(self.rows)["ordinary_without_J05"]["recorded_token_proxy"]
        self.assertLess(r["ratio_of_sums_minus_one"],0)
        self.assertGreater(r["paired_relative_delta_median"],0)
    def test_unknown_cost_is_not_zero(self):
        r=module.recompute(self.rows)["all8_as_reported"]["monetary_cost"]
        self.assertEqual(r["paired_known"],0)
        self.assertIsNone(r["baseline_sum"])
    def test_no_new_effect_claim(self):
        r=module.recompute(self.rows)
        self.assertFalse(r["balanced_effect_verified"])
        self.assertFalse(r["new_publication_claim"])
    def test_attempt_coverage_not_invented(self):
        r=module.recompute(self.rows)["all8_as_reported"]["recorded_wall_ms"]
        self.assertFalse(r["all_attempts_covered"])
    def test_duplicate_pair_rejected(self):
        with self.assertRaises(ValueError):module.recompute(self.rows+[self.rows[0]])
    def test_binary_mean_not_median(self):
        rows=[]
        for b in [True,False,True,True]:
            rows.append({"baseline":{"status":"complete","taskPassed":True},"candidate":{"status":"complete","taskPassed":b}})
        self.assertEqual(module.summarize(rows)["quality_paired_mean_as_recorded"],-.25)
    def test_unmeasured_critical_not_success(self):
        r=module.recompute(self.rows)
        self.assertEqual(r["all8_as_reported"]["critical_checks_measured"],0)
    def test_invalid_numeric_not_included(self):
        self.assertFalse(module.numeric(float("nan")))
        self.assertFalse(module.numeric(True))
        self.assertFalse(module.numeric(-1))

class Utf8Tests(unittest.TestCase):
    def test_no_forward_rounding(self):self.assertEqual(prefix("€€",1),"")
    def test_complete_codepoint(self):self.assertEqual(prefix("€€",3),"€")
    def test_emoji(self):self.assertEqual(prefix("🙂x",4),"🙂")
    def test_every_budget(self):
        s="a中🙂é€"
        for n in range(len(s.encode())+3):
            p=prefix(s,n)
            self.assertLessEqual(len(p.encode()),n)
            self.assertTrue(s.startswith(p))
    def test_invalid(self):
        for v in [-1,1.5,True]:
            with self.assertRaises(ValueError):prefix("x",v)

if __name__=="__main__":unittest.main()
