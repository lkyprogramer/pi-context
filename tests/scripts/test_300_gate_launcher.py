import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'scripts/run-300-gate-nohup.sh'

class LauncherTest(unittest.TestCase):
    def run_child(self, runner_exit=0, verifier_exit=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'bin').mkdir()
            (root / 'nvm').mkdir()
            (root / 'nvm/nvm.sh').write_text('nvm() { :; }\n')
            script = root / 'scripts/run-300-gate-nohup.sh'
            script.write_text(SOURCE.read_text().replace('/usr/local/opt/nvm/nvm.sh', str(root / 'nvm/nvm.sh')))
            calls = root / 'calls'
            for command, status in [('pnpm', runner_exit), ('node', verifier_exit)]:
                stub = root / 'bin' / command
                stub.write_text(f'#!/bin/bash\necho "{command} $*" >> "$CALLS"\nexit {status}\n')
                stub.chmod(0o755)
            result = subprocess.run(['bash', str(script), '--child'], env={**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'CALLS': str(calls)}, capture_output=True)
            return result.returncode, calls.read_text() if calls.exists() else ''

    def test_standalone_runner_then_verifier(self):
        code, calls = self.run_child()
        self.assertEqual(code, 0)
        self.assertEqual(calls.splitlines(), ['pnpm exec tsx tests/live-gate/paired-w2-live.ts', 'node scripts/release/verify-w2-live.mjs'])

    def test_runner_failure_stops_verification(self):
        code, calls = self.run_child(runner_exit=7)
        self.assertEqual(code, 7)
        self.assertNotIn('node ', calls)

    def test_verifier_failure_is_reported(self):
        code, _ = self.run_child(verifier_exit=9)
        self.assertEqual(code, 9)

if __name__ == '__main__':
    unittest.main()
