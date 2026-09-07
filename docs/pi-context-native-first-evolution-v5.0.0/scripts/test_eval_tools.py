#!/usr/bin/env python3
"""Tests for the bundled reporting utility, not the future Pi implementation."""
import copy
import math
import unittest
import summarize_pairs as tool


def pair(cluster='c1', repetition=0, bp=True, cp=True, kind='real-run'):
    def arm(name, passed):
        return dict(arm=name,status='complete',taskPassed=passed,criticalViolation=False,wallMs=1000,monetaryCost=1.0)
    return dict(kind=kind,taskId=cluster,clusterId=cluster,repetition=repetition,provenance='synthetic',baseline=arm('B0',bp),candidate=arm('B2',cp))

class StatsTests(unittest.TestCase):
    def test_empty_is_not_evidence(self):
        s=tool.summarize([])
        self.assertEqual(s['completePairs'],0)
        self.assertIsNone(s['adverseClusterRateUpper95'])
        self.assertFalse(s['publicationClaimAllowed'])
    def test_eight_all_pass_does_not_prove_two_percent(self):
        s=tool.summarize([pair(str(i)) for i in range(8)])
        self.assertEqual(s['completeClusters'],8)
        self.assertAlmostEqual(s['adverseClusterRateUpper95'],1-0.05**(1/8))
        self.assertFalse(s['twoPercentAdverseBoundSatisfied'])
    def test_repetitions_are_not_independent_tasks(self):
        s=tool.summarize([pair('same',i) for i in range(16)])
        self.assertEqual(s['completePairs'],16)
        self.assertEqual(s['completeClusters'],1)
        self.assertAlmostEqual(s['adverseClusterRateUpper95'],0.95)
    def test_missing_pair_preserved(self):
        p=pair('missing')
        p['candidate'].update(status='blocked',taskPassed=None,criticalViolation=None,wallMs=None,monetaryCost=None)
        s=tool.summarize([pair(),p])
        self.assertEqual(s['plannedPairs'],2)
        self.assertEqual(s['completePairs'],1)
        self.assertEqual(s['incompletePairs'],1)
        self.assertIsNone(s['monetaryDeltaPct'])
        self.assertIsNone(s['medianWallDeltaPct'])
    def test_partial_cost_is_not_zero(self):
        p=pair();p['candidate']['monetaryCost']=None
        s=tool.summarize([p])
        self.assertIsNone(s['monetaryDeltaPct'])
        self.assertEqual(s['knownCostPairs'],0)
    def test_mixed_demo_and_real_rejected(self):
        with self.assertRaises(ValueError):tool.summarize([pair(),pair('b',kind='synthetic-example')])
    def test_duplicate_pair_rejected(self):
        with self.assertRaises(ValueError):tool.summarize([pair(),pair()])
    def test_adverse_cluster_and_critical_counts(self):
        p=pair('a',cp=False);p['candidate']['criticalViolation']=True
        s=tool.summarize([p,pair('b',bp=False,cp=True)])
        self.assertEqual(s['adverseClusters'],1)
        self.assertEqual(s['candidateCriticalViolations'],1)
        self.assertFalse(s['publicationClaimAllowed'])
    def test_cost_and_time_ratios(self):
        p=pair();p['candidate']['monetaryCost']=.75;p['candidate']['wallMs']=900
        s=tool.summarize([p]);self.assertEqual(s['monetaryDeltaPct'],-25)
        self.assertEqual(s['medianWallDeltaPct'],-10)
    def test_invalid_values_rejected(self):
        for field,val in [('monetaryCost',-1),('wallMs',float('nan'))]:
            p=pair();p['candidate'][field]=val
            with self.assertRaises(ValueError):tool.summarize([p])
    def test_one_sided_binomial_upper(self):
        self.assertIsNone(tool.clopper_upper(0,0))
        self.assertEqual(tool.clopper_upper(3,3),1)
        self.assertAlmostEqual(tool.clopper_upper(0,150),1-.05**(1/150))
        u=tool.clopper_upper(1,10)
        self.assertGreater(u,.1);self.assertLess(u,.5)
        self.assertAlmostEqual((1-u)**10+10*u*(1-u)**9,.05,places=9)

if __name__=='__main__':unittest.main(verbosity=2)
