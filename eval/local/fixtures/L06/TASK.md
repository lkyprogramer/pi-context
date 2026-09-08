Fix VerificationStatus.java in this directory.

isCurrentSuccess(runs, revision) must use the latest evidence for that revision only.
- an older passing run must not override a newer failure on the same revision
- latest evidence wins regardless of input order
- a different revision must not override the current revision's success
- latest unknown (passed=null) is not success
- empty evidence is not success

Use read/write/edit/bash as needed. Only modify VerificationStatus.java. Reply DONE when saved.
