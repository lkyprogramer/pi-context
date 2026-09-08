import importlib.util, unittest, copy
from pathlib import Path
P=Path(__file__).resolve().parents[1]/'scripts/recompute_report.py'
spec=importlib.util.spec_from_file_location('recompute',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def row(i='x'):
    return {'id':i,'family':'synthetic','b0':good(100),'b1':good(120),'b2':good(80),'f0':good(140)}
def good(n):return {'ok':True,'closedLoopSuccess':1,'probeInputTokens':n,'recoveryStatus':'n/a','recoveryDenominator':0}
class Tests(unittest.TestCase):
 def test_no_recovery_is_unknown(self):
    x=m.summarize({'pairs':[row()]})['arms']['b2']['recovery'];self.assertIsNone(x['passRate']);self.assertEqual(x['conclusion'],'not-tested')
 def test_optional_failure_keeps_primary_pair(self):
    r=row();r['b1']={'ok':False};x=m.summarize({'pairs':[r]});self.assertEqual(x['complete4'],0);self.assertEqual(x['primaryComplete'],1)
 def test_itt_keeps_failure(self):
    r=row();r['b2']={'ok':False};x=m.summarize({'pairs':[r]});self.assertEqual(x['intentToTreatReportedScores']['reportedSuccessCandidate'],0);self.assertEqual(x['planned'],1)
 def test_duplicate_rejected(self):
    with self.assertRaises(ValueError):m.summarize({'pairs':[row(),row()]})
 def test_empty(self):
    x=m.summarize({'pairs':[]});self.assertIsNone(x['complete4Comparison']['medianPairedInputDelta'])
 def test_null_not_zero(self):
    r=row();r['b2']['probeInputTokens']=None;x=m.summarize({'pairs':[r]});self.assertEqual(x['complete4Comparison']['observedInputPairs'],0)
 def test_relative_and_medians_differ(self):
    r1=row('1');r2=row('2');r3=row('3');r1['b0']=good(1);r1['b2']=good(2);r2['b0']=good(10);r2['b2']=good(9);r3['b0']=good(100);r3['b2']=good(50)
    x=m.summarize({'pairs':[r1,r2,r3]});self.assertAlmostEqual(x['complete4Comparison']['medianPairedInputDelta'],-0.1)
 def test_inputs_unmodified(self):
    d={'pairs':[row()]};old=copy.deepcopy(d);m.summarize(d);self.assertEqual(d,old)
 def test_zero_denominator(self):
    r=row();r['b0']['probeInputTokens']=0;x=m.summarize({'pairs':[r]});self.assertIsNone(x['complete4Comparison']['medianPairedInputDelta'])
 def test_actual_observed_recovery(self):
    r=row();r['b2'].update(recoveryStatus='ok',recoveryDenominator=1);x=m.summarize({'pairs':[r]});self.assertEqual(x['arms']['b2']['recovery']['passRate'],1)
 def test_no_fake_currency(self):
    x=m.summarize({'pairs':[row()]});self.assertNotIn('monetaryCost',x);self.assertAlmostEqual(x['complete4Comparison']['medianPairedInputDelta'],-.2)
if __name__=='__main__':unittest.main()
