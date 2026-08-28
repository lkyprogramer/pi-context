import unittest

from reference.reference_scorer import (
    W1GateInput,
    evaluate_w1_gate,
    mcnemar_table,
    paired_bootstrap_ci,
    relative_delta,
)


class ReferenceScorerTest(unittest.TestCase):
    def test_relative_delta(self):
        self.assertAlmostEqual(relative_delta(80, 100), -0.2)

    def test_bootstrap_is_deterministic(self):
        a = paired_bootstrap_ci([1, 2, 3, 4], [2, 2, 4, 5], samples=1000, seed=7)
        b = paired_bootstrap_ci([1, 2, 3, 4], [2, 2, 4, 5], samples=1000, seed=7)
        self.assertEqual(a, b)

    def test_mcnemar_table(self):
        self.assertEqual(
            mcnemar_table([True, True, False, False], [True, False, True, False]),
            {"both_pass": 1, "baseline_only": 1, "candidate_only": 1, "both_fail": 1},
        )

    def test_w1_gate_proceeds_only_after_all_layers(self):
        x = W1GateInput(
            integrity_pass=True,
            quality_ci_lower=-0.01,
            quality_margin=0.03,
            ingress_token_median_delta=-0.24,
            ingress_token_ci_upper=-0.12,
            hook_p95_ms=40,
            recall_at_5=0.95,
            recall_precision=0.82,
            silence_rate=0.93,
            recall_quality_ci_lower=-0.005,
            recall_quality_margin=0.01,
            recall_needed_success_delta=0.04,
            realized_net_median=0.01,
        )
        self.assertEqual(evaluate_w1_gate(x), "proceed-to-w2")

    def test_integrity_failure_stops(self):
        x = W1GateInput(
            integrity_pass=False,
            quality_ci_lower=0.1,
            quality_margin=0.03,
            ingress_token_median_delta=-0.9,
            ingress_token_ci_upper=-0.8,
            hook_p95_ms=1,
            recall_at_5=1,
            recall_precision=1,
            silence_rate=1,
            recall_quality_ci_lower=0.1,
            recall_quality_margin=0.01,
            recall_needed_success_delta=1,
            realized_net_median=100,
        )
        self.assertEqual(evaluate_w1_gate(x), "stop")


if __name__ == "__main__":
    unittest.main()
