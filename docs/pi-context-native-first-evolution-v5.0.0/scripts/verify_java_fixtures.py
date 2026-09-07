#!/usr/bin/env python3
"""Calibrate bundled Java oracles: intentionally broken source RED, reference GREEN.
This executes trusted bundled fixtures only. It is NOT an arbitrary-code sandbox.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

def run(root: Path) -> dict:
    if not shutil.which('javac') or not shutil.which('java'):
        return {'kind':'java-oracle-calibration','status':'not-run','reason':'JDK unavailable','rows':[]}
    cases={'J01':'Deduplicator.java','J02':'TenantRepository.java','J07':'VerificationStatus.java'}
    rows=[]
    for case,filename in cases.items():
        source=root/'fixtures/java'/case
        outcomes={}
        for mode in ('initial','known-good'):
            with tempfile.TemporaryDirectory(prefix='pctx-oracle-') as tmp:
                work=Path(tmp)
                content=(source/'initial'/filename if mode=='initial' else source/'grader/KnownGood.java.txt').read_text()
                (work/filename).write_text(content)
                shutil.copy(source/'grader/Oracle.java',work/'Oracle.java')
                build=subprocess.run(['javac','--release','8',filename,'Oracle.java'],cwd=work,capture_output=True,text=True,timeout=25)
                if build.returncode:
                    outcomes[mode]={'compileExit':build.returncode,'runExit':None,'output':build.stderr[-2000:]}
                    continue
                result=subprocess.run(['java','-cp',str(work),'Oracle'],cwd=work,capture_output=True,text=True,timeout=10)
                outcomes[mode]={'compileExit':0,'runExit':result.returncode,'output':(result.stdout+result.stderr)[-2000:]}
        red=outcomes['initial'];green=outcomes['known-good']
        okay=red['compileExit']==0 and red['runExit'] not in (None,0) and 'AssertionError' in red['output'] and green['compileExit']==0 and green['runExit']==0 and f'ORACLE_PASS:{case}' in green['output']
        rows.append({'case':case,'calibrated':okay,'outcomes':outcomes})
    return {'kind':'java-oracle-calibration','status':'passed' if all(r['calibrated'] for r in rows) else 'failed','productTestsExecuted':False,'liveModelExecuted':False,'rows':rows}

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);ap.add_argument('--output',type=Path)
    args=ap.parse_args()
    try: result=run(args.root)
    except (OSError,subprocess.SubprocessError) as exc:
        result={'kind':'java-oracle-calibration','status':'failed','error':str(exc)}
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    print(text,end='')
    if args.output:args.output.write_text(text)
    return 0 if result['status']=='passed' else 2
if __name__=='__main__':raise SystemExit(main())
