import unittest
from reference_metrics import normalize_usage, median, aggregate_attempts, paired_success_delta, evaluate_trial

def req(i,n):
    return dict(requestId=i,source='pi-disjoint',usage=dict(input=n,cacheRead=0,cacheWrite=0,output=1))
def pair(**kwargs):
    return dict(caseId='q',rep=0,nativePassed=True,candidatePassed=True,foldRequired=True,foldApplied=True,criticalViolation=False,evidencePassed=True,**kwargs)
def objective(known=True, change=-.2):
    return dict(metric='logical-input',known=known,relativeChange=change,minImprovement=.1)
class Tests(unittest.TestCase):
    def test_pi_disjoint(self):
        u=normalize_usage(dict(input=100,cacheRead=60,cacheWrite=0,output=1),'pi-disjoint')
        self.assertEqual((u['freshInput'],u['logicalInput']), (100,160));self.assertEqual(u['cacheRatio'],.375)
    def test_cached_greater_than_fresh_is_valid(self):
        u=normalize_usage(dict(input=40,cacheRead=60,cacheWrite=0,output=1),'pi-disjoint')
        self.assertTrue(u['complete']);self.assertEqual(u['cacheRatio'],.6)
    def test_raw_inclusive(self):
        u=normalize_usage(dict(prompt_tokens=100,completion_tokens=4,prompt_tokens_details={'cached_tokens':60,'cache_write_tokens':0}),'raw-openai-inclusive')
        self.assertEqual((u['freshInput'],u['logicalInput']), (40,100))
    def test_invalid_inclusive(self):
        u=normalize_usage(dict(prompt_tokens=10,completion_tokens=1,prompt_tokens_details={'cached_tokens':20,'cache_write_tokens':0}),'raw-openai-inclusive')
        self.assertFalse(u['complete']);self.assertIsNone(u['logicalInput'])
    def test_missing_is_not_zero(self):
        u=normalize_usage(dict(input=1,output=1),'pi-disjoint');self.assertIsNone(u['logicalInput'])
    def test_no_reasoning_double_count(self):
        u=normalize_usage(dict(input=1,cacheRead=0,cacheWrite=0,output=4,reasoning=3),'pi-disjoint');self.assertEqual(u['output'],4)
    def test_median_even(self): self.assertEqual(median([10,100]),55)
    def test_median_empty(self): self.assertIsNone(median([]))
    def test_retry_accounted(self):
        a=[dict(episodeId='e',attemptId='a1',status='timeout',requests=[req('q1',1000)]),dict(episodeId='e',attemptId='a2',status='passed',requests=[req('q2',10)])]
        e=aggregate_attempts(a)['episodes']['e'];self.assertEqual(e['logicalInput'],1010);self.assertEqual(e['firstStatus'],'timeout')
    def test_unknown_retry_total(self):
        a=[dict(episodeId='e',attemptId='a',status='timeout',requests=[dict(requestId='q',source='pi-disjoint',usage=None)]),dict(episodeId='e',attemptId='b',status='passed',requests=[req('q2',10)])]
        e=aggregate_attempts(a)['episodes']['e'];self.assertIsNone(e['logicalInput']);self.assertEqual(e['knownLogicalSubtotal'],10)
    def test_duplicate_observation(self):
        a=dict(episodeId='e',attemptId='a',status='passed',requests=[req('q',10),req('q',10)])
        self.assertEqual(aggregate_attempts([a])['episodes']['e']['logicalInput'],10)
    def test_conflicting_id(self):
        a=dict(episodeId='e',attemptId='a',status='passed',requests=[req('q',10),req('q',20)])
        with self.assertRaises(ValueError): aggregate_attempts([a])
    def test_quality_delta_uses_mean(self):
        a=[pair() for _ in range(12)]
        for p in a[::2]:p['candidatePassed']=False
        self.assertEqual(paired_success_delta(a),-.5)
        self.assertEqual(evaluate_trial(a,[dict(eligible=True,passed=True)],objective(change=.4))['decision'],'review-needed')
    def test_no_fold_inconclusive(self):
        p=pair();p['foldApplied']=False
        self.assertEqual(evaluate_trial([p],[],objective())['decision'],'inconclusive')
    def test_quote_failure(self):
        p=pair();p['evidencePassed']=False
        self.assertEqual(evaluate_trial([p],[],objective())['decision'],'review-needed')
    def test_no_gain(self):
        self.assertEqual(evaluate_trial([pair()],[dict(eligible=True,passed=True)],objective(change=.08))['decision'],'history-only')
    def test_unknown_cost(self):
        self.assertEqual(evaluate_trial([pair()],[dict(eligible=True,passed=True)],objective(known=False))['decision'],'quality-qualified-cost-unknown')
    def test_small_trial_not_general(self):
        self.assertEqual(evaluate_trial([pair()],[dict(eligible=True,passed=True)],objective())['decision'],'limited-balanced-trial')
    def test_missing_pair(self):
        self.assertEqual(evaluate_trial([pair()],[],objective(),expected_pairs=2)['decision'],'inconclusive')
    def test_capability_zero_not_pass(self):
        self.assertEqual(evaluate_trial([pair()],[],objective())['decision'],'inconclusive')
if __name__=='__main__':unittest.main()
